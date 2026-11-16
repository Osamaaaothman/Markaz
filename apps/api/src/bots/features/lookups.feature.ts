import { SalesError } from "@erp/core";
import { Prisma } from "@erp/db";
import type { Action, Field } from "@erp/bots";
import type { BotContext, BotFeature, BotUserContext, Intent } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { asOfFooter, backToMenu, button, card, localizedName, openInErp, rows, todayIso, type BotServices } from "./feature-kit.js";

// Read-only lookups (docs/BOTS-INTEGRATION-PLAN.md §5.3). Each one needs the same read permission as
// its web screen.

const RESULTS = 8;

async function requireRead(ctx: BotContext, resource: string): Promise<void> {
  if (!(await ctx.can("read", resource))) throw new BotNotice("errors.forbidden", {}, "danger");
}

function cleanQuery(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 100);
}

type SearchKind = "customers" | "items" | "invoices";

const SEARCH_ACTION: Readonly<Record<SearchKind, string>> = { customers: "searchCustomers", items: "searchItems", invoices: "searchInvoices" };

// The button that asks for a search term (a pop-up form on Discord, a reply prompt on Telegram).
export function searchIntent(kind: SearchKind): Intent {
  return { f: "lookups", a: SEARCH_ACTION[kind], form: kind };
}

function resultsCard(ctx: BotContext, kind: SearchKind, query: string, options: Action<Intent>[]) {
  const again = button(ctx.t("lookups.searchAgain"), searchIntent(kind), "secondary", "search");
  if (options.length === 0) {
    return card(
      ctx,
      [
        { type: "header", tone: "neutral", icon: "search", title: ctx.t("lookups.noResults", { query }) },
        { type: "text", text: ctx.t("lookups.noResultsHint"), emphasis: "muted" },
      ],
      rows([again, backToMenu(ctx)]),
    );
  }
  return card(
    ctx,
    [
      { type: "header", tone: "info", icon: "search", title: ctx.t(`lookups.${kind}Title`), subtitle: ctx.t("lookups.resultsFor", { query, count: options.length }) },
      { type: "text", text: ctx.t("lookups.pickOne"), emphasis: "muted" },
    ],
    rows(...options.map((o) => [o]), [again, backToMenu(ctx)]),
  );
}

export function createLookupsFeature(services: BotServices): BotFeature {
  const searchCustomers = async (ctx: BotContext, q: string) => {
    await requireRead(ctx, "party");
    if (!q) throw new BotNotice("lookups.queryRequired", {}, "info");
    const page = await services.parties.list(ctx.connection.companyId, { q, kind: "CUSTOMER", limit: String(RESULTS), excludeEmployees: "true" });
    await ctx.reply(
      resultsCard(
        ctx,
        "customers",
        q,
        page.data.map((p) => button(localizedName(ctx, p.name, p.nameAr), { f: "lookups", a: "customer", p: { id: p.id } }, "secondary", "customer")),
      ),
    );
  };

  const searchItems = async (ctx: BotContext, q: string) => {
    await requireRead(ctx, "item");
    if (!q) throw new BotNotice("lookups.queryRequired", {}, "info");
    const page = await services.items.list(ctx.connection.companyId, { q, limit: String(RESULTS) });
    await ctx.reply(
      resultsCard(
        ctx,
        "items",
        q,
        page.data.map((i) => button(`${i.code} · ${localizedName(ctx, i.name, i.nameAr)}`, { f: "lookups", a: "item", p: { id: i.id } }, "secondary", "stock")),
      ),
    );
  };

  const searchInvoices = async (ctx: BotContext, q: string) => {
    await requireRead(ctx, "sales_invoice");
    if (!q) throw new BotNotice("lookups.queryRequired", {}, "info");
    const found = await services.prisma.salesInvoice.findMany({
      where: { companyId: ctx.connection.companyId, number: { contains: q, mode: "insensitive" } },
      orderBy: { invoiceDate: "desc" },
      take: RESULTS,
      select: { id: true, number: true, totalGross: true, currency: true, customer: { select: { name: true, nameAr: true } } },
    });
    await ctx.reply(
      resultsCard(
        ctx,
        "invoices",
        q,
        found.map((i) =>
          button(`${i.number} · ${localizedName(ctx, i.customer.name, i.customer.nameAr)} · ${ctx.fmt.money(i.totalGross.toFixed(4), i.currency)}`, { f: "lookups", a: "invoice", p: { id: i.id } }, "secondary", "invoice"),
        ),
      ),
    );
  };

  const cash = async (ctx: BotContext) => {
    await requireRead(ctx, "balance_sheet");
    const data = await services.dashboard.compute(ctx.connection.companyId, {
      receivables: false,
      payables: false,
      profit: false,
      cash: true,
      stock: false,
      sales: false,
      purchasing: false,
    });
    const balance = data.cash?.balance;
    await ctx.reply(
      card(
        ctx,
        [
          { type: "header", tone: "info", icon: "cash", title: ctx.t("lookups.cashTitle") },
          { type: "fields", items: [balance ? { label: ctx.t("lookups.cashBalance"), value: ctx.fmt.money(balance, data.currency), strong: true } : { label: ctx.t("lookups.cashBalance"), value: ctx.t("lookups.cashNotMapped") }] },
          asOfFooter(ctx),
        ],
        rows(openInErp(ctx, "/accounting/balance-sheet"), [backToMenu(ctx)]),
      ),
    );
  };

  return {
    key: "lookups",
    toggle: "lookups",
    commands: {
      customer: async (ctx, args) => searchCustomers(ctx, cleanQuery(args)),
      item: async (ctx, args) => searchItems(ctx, cleanQuery(args)),
      invoice: async (ctx, args) => searchInvoices(ctx, cleanQuery(args)),
      cash: async (ctx) => cash(ctx),
    },
    forms: Object.fromEntries(
      (["customers", "items", "invoices"] as const).map((kind) => [
        kind,
        (ctx: BotUserContext) => ({
          title: ctx.t(`lookups.search.${kind}.title`),
          fields: [{ key: "q", label: ctx.t(`lookups.search.${kind}.hint`), placeholder: ctx.t(`lookups.search.${kind}.placeholder`), multiline: false, required: true, maxLength: 100 }],
        }),
      ]),
    ),
    actions: {
      searchCustomers: async (ctx, _p, fields) => searchCustomers(ctx, cleanQuery(fields["q"])),
      searchItems: async (ctx, _p, fields) => searchItems(ctx, cleanQuery(fields["q"])),
      searchInvoices: async (ctx, _p, fields) => searchInvoices(ctx, cleanQuery(fields["q"])),
      cash: async (ctx) => cash(ctx),

      customer: async (ctx, p) => {
        await requireRead(ctx, "party");
        const party = await services.prisma.party.findFirst({ where: { id: p["id"] ?? "", companyId: ctx.connection.companyId } });
        if (!party) throw new BotNotice("lookups.notFound");
        const canStatement = await ctx.can("read", "party_statement");
        const fields: Field[] = [
          { label: ctx.t("lookups.reference"), value: party.ref, copy: true },
          ...(party.phone ? [{ label: ctx.t("lookups.phone"), value: party.phone, copy: true }] : []),
          ...(party.vatNumber ? [{ label: ctx.t("lookups.vat"), value: party.vatNumber, copy: true }] : []),
        ];
        if (canStatement) {
          const today = todayIso(ctx.connection.timezone);
          const statement = await services.statements.statement(ctx.connection.companyId, party.id, "SALES", new Date("2000-01-01T00:00:00Z"), new Date(`${today}T00:00:00Z`));
          const balance = statement.closingBalance;
          fields.push({ label: ctx.t("lookups.balance"), value: ctx.fmt.money(balance, ctx.connection.currency), strong: true });
          const last = statement.lines.at(-1);
          if (last) fields.push({ label: ctx.t("lookups.lastActivity"), value: `${last.number} · ${ctx.fmt.date(last.date)}` });
        }
        const documentsOn = ctx.featureEnabled("documents") && canStatement;
        await ctx.reply(
          card(
            ctx,
            [
              { type: "header", tone: "info", icon: "customer", title: localizedName(ctx, party.name, party.nameAr), subtitle: ctx.t("lookups.customerSubtitle") },
              { type: "fields", items: fields },
              asOfFooter(ctx),
            ],
            rows(
              documentsOn ? [button(ctx.t("documents.statementPdf"), { f: "documents", a: "statement", p: { partyId: party.id } }, "primary", "pdf")] : [],
              openInErp(ctx, `/accounting/party-statement?partyId=${party.id}`),
              [backToMenu(ctx)],
            ),
          ),
        );
      },

      item: async (ctx, p) => {
        await requireRead(ctx, "item");
        const item = await services.prisma.item.findFirst({ where: { id: p["id"] ?? "", companyId: ctx.connection.companyId } });
        if (!item) throw new BotNotice("lookups.notFound");
        const canStock = await ctx.can("read", "stock");
        const levels = canStock ? await services.stock.list(ctx.connection.companyId, { itemId: item.id }) : [];
        const below = levels.some((l) => l.belowReorderPoint);
        await ctx.reply(
          card(
            ctx,
            [
              { type: "header", tone: below ? "warning" : "info", icon: "stock", title: localizedName(ctx, item.name, item.nameAr), subtitle: ctx.t("lookups.byWarehouse") },
              { type: "fields", items: [
                  { label: ctx.t("lookups.code"), value: item.code, copy: true },
                  ...(canStock ? [{ label: ctx.t("lookups.onHand"), value: `${ctx.fmt.quantity(levels.reduce((sum, l) => sum.plus(l.quantity), new Prisma.Decimal(0)).toFixed(4))} ${item.unit}`, strong: true, ...(below ? { tone: "warning" as const } : {}) }] : []),
                  { label: ctx.t("lookups.reorderPoint"), value: `${ctx.fmt.quantity(item.reorderPoint.toFixed(4))} ${item.unit}` },
                ] },
              canStock
                ? {
                    type: "list",
                    items:
                      levels.length > 0
                        ? levels.map((l) => ({
                            tone: l.belowReorderPoint ? ("warning" as const) : ("success" as const),
                            title: localizedName(ctx, l.warehouseName, l.warehouseNameAr),
                            detail: `${ctx.fmt.quantity(l.quantity)} ${item.unit} · ${ctx.fmt.money(l.value, ctx.connection.currency)}`,
                          }))
                        : [{ tone: "neutral" as const, title: ctx.t("lookups.noStock") }],
                  }
                : { type: "text", text: ctx.t("lookups.noStockPermission"), emphasis: "muted" },
              asOfFooter(ctx),
            ],
            rows(openInErp(ctx, "/inventory/stock-levels"), [backToMenu(ctx)]),
          ),
        );
      },

      invoice: async (ctx, p) => {
        await requireRead(ctx, "sales_invoice");
        let invoice;
        try {
          invoice = await services.invoices.get(ctx.connection.companyId, p["id"] ?? "");
        } catch (error) {
          if (error instanceof SalesError) throw new BotNotice("lookups.notFound");
          throw error;
        }
        const zatca = await services.prisma.zatcaInvoiceRecord.findFirst({ where: { salesInvoiceId: invoice.id, companyId: ctx.connection.companyId }, select: { status: true } });
        const settledTone = invoice.settlementStatus === "SETTLED" ? "success" : invoice.settlementStatus === "OVERDUE" ? "danger" : "info";
        const zatcaTone = !zatca ? undefined : ["CLEARED", "REPORTED"].includes(zatca.status) ? ("success" as const) : ["REJECTED", "NOT_CLEARED", "FAILED"].includes(zatca.status) ? ("danger" as const) : ("warning" as const);
        await ctx.reply(
          card(
            ctx,
            [
              { type: "header", tone: settledTone, icon: "invoice", title: localizedName(ctx, invoice.customerName, invoice.customerNameAr), subtitle: ctx.t(`lookups.documentType.${invoice.documentType}`) },
              {
                type: "fields",
                items: [
                  { label: ctx.t("lookups.number"), value: invoice.number, copy: true },
                  { label: ctx.t("lookups.invoiceDate"), value: ctx.fmt.date(invoice.invoiceDate) },
                  ...(invoice.dueDate ? [{ label: ctx.t("lookups.dueDate"), value: ctx.fmt.date(invoice.dueDate) }] : []),
                  { label: ctx.t("lookups.total"), value: ctx.fmt.money(invoice.totalGross, invoice.currency), strong: true },
                  ...(invoice.outstandingAmount !== null ? [{ label: ctx.t("lookups.outstanding"), value: ctx.fmt.money(invoice.outstandingAmount, invoice.currency) }] : []),
                  { label: ctx.t("lookups.settlement"), value: ctx.t(`lookups.settlementStatus.${invoice.settlementStatus}`, { defaultValue: invoice.settlementStatus }), tone: settledTone },
                  ...(zatca && zatcaTone ? [{ label: ctx.t("lookups.zatca"), value: ctx.t(`lookups.zatcaStatus.${zatca.status}`, { defaultValue: zatca.status }), tone: zatcaTone }] : []),
                ],
              },
              asOfFooter(ctx),
            ],
            rows(
              ctx.featureEnabled("documents") ? [button(ctx.t("documents.invoicePdf"), { f: "documents", a: "invoice", p: { id: invoice.id } }, "primary", "pdf")] : [],
              openInErp(ctx, `/sales/invoices/${invoice.id}`),
              [backToMenu(ctx)],
            ),
          ),
        );
      },
    },
  };
}
