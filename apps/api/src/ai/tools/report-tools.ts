import { defineReadTool, type DisplayBlock, type ErpTool, type ToolContext } from "@erp/ai";
import type {
  AgingService,
  BalanceSheetService,
  CashFlowService,
  GeneralLedgerService,
  IncomeStatementService,
  PartyStatementService,
  PurchaseOrderService,
  StockLevelService,
} from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { z } from "zod";

// Report tools: each wraps the same core service the report screen uses, so an answer can never
// disagree with the report behind it. Every sum or difference shown is computed here with exact
// decimals (or by the service) — the model only reports figures (plan §0.1 rule 4).

export interface ReportToolServices {
  readonly prisma: PrismaClient;
  readonly stock: StockLevelService;
  readonly incomeStatement: IncomeStatementService;
  readonly balanceSheet: BalanceSheetService;
  readonly cashFlow: CashFlowService;
  readonly aging: AgingService;
  readonly partyStatements: PartyStatementService;
  readonly ledger: GeneralLedgerService;
  readonly purchaseOrders: PurchaseOrderService;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const money = (v: string | Prisma.Decimal): string => (typeof v === "string" ? dec(v) : v).toFixed(2);
const localName = (ctx: ToolContext, en: string, ar: string | null): string => (ctx.locale === "ar" && ar ? ar : en);
const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

async function companyToday(prisma: PrismaClient, companyId: string): Promise<string> {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  return new Intl.DateTimeFormat("en-CA", { timeZone: c.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Default period: from the 1st of the current month to today, in the company's timezone.
async function period(prisma: PrismaClient, companyId: string, from?: string, to?: string): Promise<{ from: string; to: string }> {
  const today = await companyToday(prisma, companyId);
  return { from: from ?? `${today.slice(0, 8)}01`, to: to ?? today };
}

function kpis(titleKey: string, currency: string, items: Array<[string, string, ("money" | "number")?]>): DisplayBlock {
  return { kind: "kpis", titleKey, items: items.map(([labelKey, value, format]) => ({ labelKey, value, format: format ?? "money", currency })) };
}

async function currencyOf(prisma: PrismaClient, companyId: string): Promise<string> {
  return (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } })).defaultCurrency;
}

export function buildReportTools(s: ReportToolServices): ErpTool[] {
  const stockLevels = defineReadTool({
    name: "inventory_stockLevels",
    description:
      "Stock on hand per item and warehouse: quantity, value and reorder point. Optional text filter on item code/name, " +
      "and belowReorderOnly=true to list only items at or below their reorder point (the low-stock / reorder list). " +
      "Returns the total stock value of the listed rows.",
    input: z.object({ query: z.string().trim().max(100).optional(), belowReorderOnly: z.boolean().default(false) }),
    permission: { resource: "stock", action: "read" },
    run: async (ctx, input) => {
      const all = await s.stock.list(ctx.actor.companyId, { belowReorderOnly: input.belowReorderOnly ? "true" : "false" });
      const q = input.query?.toLowerCase();
      const rows = (q ? all.filter((r) => `${r.itemCode} ${r.itemName} ${r.itemNameAr ?? ""}`.toLowerCase().includes(q)) : all).slice(0, 30);
      const totalValue = rows.reduce((acc, r) => acc.plus(dec(r.value)), new Prisma.Decimal(0));
      const data = rows.map((r) => ({
        code: r.itemCode,
        item: localName(ctx, r.itemName, r.itemNameAr),
        warehouse: localName(ctx, r.warehouseName, r.warehouseNameAr),
        quantity: dec(r.quantity).toString(),
        reorderPoint: dec(r.reorderPoint).toString(),
        value: money(r.value),
        belowReorder: r.belowReorderPoint ? "yes" : "no",
      }));
      return {
        data: { rows: data, rowCount: data.length, totalRows: all.length, totalValue: money(totalValue) },
        display: {
          kind: "table",
          titleKey: input.belowReorderOnly ? "ai.blocks.lowStock" : "ai.blocks.stock",
          columns: [
            { key: "code", labelKey: "ai.col.code" },
            { key: "item", labelKey: "ai.col.item" },
            { key: "warehouse", labelKey: "ai.col.warehouse" },
            { key: "quantity", labelKey: "ai.col.quantity", format: "number" },
            { key: "reorderPoint", labelKey: "ai.col.reorderPoint", format: "number" },
            { key: "value", labelKey: "ai.col.value", format: "money" },
          ],
          rows: data,
          link: "/inventory/stock-levels",
        },
      };
    },
  });

  const incomeStatement = defineReadTool({
    name: "reports_incomeStatement",
    description:
      "Income statement (profit and loss) for a period: total revenue, total expenses, net income, and the biggest revenue " +
      "and expense accounts. Defaults to this month to date. Use for profit, loss, margin or 'how much did we spend on X'.",
    input: z.object({ from: date.optional(), to: date.optional() }),
    permission: { resource: "income_statement", action: "read" },
    run: async (ctx, input) => {
      const p = await period(s.prisma, ctx.actor.companyId, input.from, input.to);
      const r = await s.incomeStatement.compute(ctx.actor.companyId, day(p.from), day(p.to));
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      const top = (lines: typeof r.revenue.lines) => [...lines].sort((a, b) => dec(b.amount).cmp(dec(a.amount))).slice(0, 8).map((l) => ({ code: l.accountCode, account: l.accountName, amount: money(l.amount) }));
      return {
        data: { from: r.from, to: r.to, currency, revenue: money(r.revenue.total), expense: money(r.expense.total), netIncome: money(r.netIncome), topRevenue: top(r.revenue.lines), topExpense: top(r.expense.lines) },
        display: kpis("ai.blocks.incomeStatement", currency, [["ai.kpi.revenue", money(r.revenue.total)], ["ai.kpi.expense", money(r.expense.total)], ["ai.kpi.netIncome", money(r.netIncome)]]),
      };
    },
  });

  const balanceSheet = defineReadTool({
    name: "reports_balanceSheet",
    description: "Balance sheet as of today: total assets, liabilities, equity (with current-year earnings), whether it balances, and the largest accounts of each section.",
    input: z.object({}),
    permission: { resource: "balance_sheet", action: "read" },
    run: async (ctx) => {
      const r = await s.balanceSheet.compute(ctx.actor.companyId);
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      const top = (lines: typeof r.assets.lines) => [...lines].sort((a, b) => dec(b.balance).abs().cmp(dec(a.balance).abs())).slice(0, 6).map((l) => ({ code: l.accountCode, account: l.accountName, balance: money(l.balance) }));
      return {
        data: { asOf: r.asOf, currency, assets: money(r.assets.total), liabilities: money(r.liabilities.total), equity: money(r.totalEquity), currentYearEarnings: money(r.currentYearEarnings), isBalanced: r.isBalanced, topAssets: top(r.assets.lines), topLiabilities: top(r.liabilities.lines) },
        display: kpis("ai.blocks.balanceSheet", currency, [["ai.kpi.assets", money(r.assets.total)], ["ai.kpi.liabilities", money(r.liabilities.total)], ["ai.kpi.equity", money(r.totalEquity)], ["ai.kpi.currentYearEarnings", money(r.currentYearEarnings)]]),
      };
    },
  });

  const cashFlow = defineReadTool({
    name: "reports_cashFlow",
    description: "Cash flow for a period: operating, investing and financing totals, net change, opening and closing cash. Defaults to this month to date.",
    input: z.object({ from: date.optional(), to: date.optional() }),
    permission: { resource: "income_statement", action: "read" },
    run: async (ctx, input) => {
      const p = await period(s.prisma, ctx.actor.companyId, input.from, input.to);
      const r = await s.cashFlow.compute(ctx.actor.companyId, day(p.from), day(p.to));
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      return {
        data: { from: r.from, to: r.to, currency, operating: money(r.operating.total), investing: money(r.investing.total), financing: money(r.financing.total), netChange: money(r.netChange), beginningCash: money(r.beginningCash), endingCash: money(r.endingCash) },
        display: kpis("ai.blocks.cashFlow", currency, [["ai.kpi.beginningCash", money(r.beginningCash)], ["ai.kpi.operating", money(r.operating.total)], ["ai.kpi.investing", money(r.investing.total)], ["ai.kpi.financing", money(r.financing.total)], ["ai.kpi.endingCash", money(r.endingCash)]]),
      };
    },
  });

  const aging = defineReadTool({
    name: "reports_aging",
    description:
      "Ageing of what customers owe us (side=CUSTOMERS) or what we owe suppliers (side=SUPPLIERS) as of today, by party: " +
      "current, 1-30, 31-60, 61-90, over 90 days, and total. Use for overdue / who owes the most / collections.",
    input: z.object({ side: z.enum(["CUSTOMERS", "SUPPLIERS"]).default("CUSTOMERS") }),
    permission: { resource: "aging_report", action: "read" },
    run: async (ctx, input) => {
      const today = await companyToday(s.prisma, ctx.actor.companyId);
      const r = await s.aging.report(ctx.actor.companyId, input.side === "CUSTOMERS" ? "SALES" : "SUPPLIER", day(today));
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      const rows = [...r.parties]
        .sort((a, b) => dec(b.total).cmp(dec(a.total)))
        .slice(0, 15)
        .map((p) => ({ party: localName(ctx, p.partyName, p.partyNameAr), current: money(p.current), days1to30: money(p.days1to30), days31to60: money(p.days31to60), days61to90: money(p.days61to90), over90: money(p.over90), total: money(p.total) }));
      const overdue = dec(r.totals.days1to30).plus(r.totals.days31to60).plus(r.totals.days61to90).plus(r.totals.over90);
      return {
        data: { side: input.side, asOf: r.asOf, currency, partyCount: r.parties.length, totals: { current: money(r.totals.current), overdue: money(overdue), over90: money(r.totals.over90), total: money(r.totals.total) }, topParties: rows },
        display: {
          kind: "table",
          titleKey: input.side === "CUSTOMERS" ? "ai.blocks.agingCustomers" : "ai.blocks.agingSuppliers",
          columns: [
            { key: "party", labelKey: "ai.col.party" },
            { key: "current", labelKey: "ai.col.current", format: "money" },
            { key: "days1to30", labelKey: "ai.col.days1to30", format: "money" },
            { key: "days31to60", labelKey: "ai.col.days31to60", format: "money" },
            { key: "days61to90", labelKey: "ai.col.days61to90", format: "money" },
            { key: "over90", labelKey: "ai.col.over90", format: "money" },
            { key: "total", labelKey: "ai.col.total", format: "money" },
          ],
          rows,
          link: "/accounting/aging",
        },
      };
    },
  });

  const partyStatement = defineReadTool({
    name: "parties_statement",
    description:
      "Statement of account for ONE customer or supplier: opening balance, invoices, payments and closing balance for a period " +
      "(default: from 1 January this year to today). Give the party's name (or reference); side CUSTOMER or SUPPLIER. " +
      "Use for 'how much does X owe us' or 'what do we owe X'. If several parties match, the matches are returned so you can ask which one.",
    input: z.object({ party: z.string().trim().min(1).max(100), side: z.enum(["CUSTOMER", "SUPPLIER"]).default("CUSTOMER"), from: date.optional(), to: date.optional() }),
    permission: { resource: "party_statement", action: "read" },
    run: async (ctx, input) => {
      const matches = await s.prisma.party.findMany({
        where: { companyId: ctx.actor.companyId, OR: [{ name: { contains: input.party, mode: "insensitive" } }, { nameAr: { contains: input.party } }, { ref: { equals: input.party, mode: "insensitive" } }] },
        select: { id: true, ref: true, name: true, nameAr: true },
        take: 6,
      });
      if (matches.length === 0) return { data: { found: false } };
      const exact = matches.find((m) => m.name === input.party || m.nameAr === input.party || m.ref.toLowerCase() === input.party.toLowerCase());
      if (!exact && matches.length > 1) return { data: { found: "several", matches: matches.map((m) => ({ ref: m.ref, name: localName(ctx, m.name, m.nameAr) })) } };
      const party = exact ?? matches[0]!;
      const today = await companyToday(s.prisma, ctx.actor.companyId);
      const from = input.from ?? `${today.slice(0, 4)}-01-01`;
      const to = input.to ?? today;
      const st = await s.partyStatements.statement(ctx.actor.companyId, party.id, input.side === "CUSTOMER" ? "SALES" : "SUPPLIER", day(from), day(to));
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      const lines = st.lines.slice(-12).map((l) => ({ date: l.date, number: l.number, charge: money(l.charge), settlement: money(l.settlement), balance: money(l.balance) }));
      return {
        data: { party: localName(ctx, st.partyName, st.partyNameAr), side: input.side, from: st.from, to: st.to, currency, openingBalance: money(st.openingBalance), totalCharges: money(st.totalCharges), totalSettlements: money(st.totalSettlements), closingBalance: money(st.closingBalance), lastLines: lines },
        display: kpis("ai.blocks.partyStatement", currency, [["ai.kpi.openingBalance", money(st.openingBalance)], ["ai.kpi.charges", money(st.totalCharges)], ["ai.kpi.settlements", money(st.totalSettlements)], ["ai.kpi.closingBalance", money(st.closingBalance)]]),
      };
    },
  });

  const accountStatement = defineReadTool({
    name: "accounts_statement",
    description:
      "Ledger statement of ONE account by its code (find the code with accounts_search first): opening balance, total debit, " +
      "total credit, closing balance and the latest entries for a period (default: 1 January this year to today).",
    input: z.object({ code: z.string().trim().min(1).max(20), from: date.optional(), to: date.optional() }),
    permission: { resource: "journal_entry", action: "read" },
    run: async (ctx, input) => {
      const account = await s.prisma.account.findFirst({ where: { companyId: ctx.actor.companyId, code: input.code }, select: { id: true } });
      if (!account) return { data: { found: false } };
      const today = await companyToday(s.prisma, ctx.actor.companyId);
      const st = await s.ledger.statement(ctx.actor.companyId, account.id, day(input.from ?? `${today.slice(0, 4)}-01-01`), day(input.to ?? today));
      const currency = await currencyOf(s.prisma, ctx.actor.companyId);
      const rows = st.lines.slice(-10).map((l) => ({ date: l.entryDate, number: l.entryNumber, description: l.description ?? "", debit: money(l.debit), credit: money(l.credit), balance: money(l.balance) }));
      return {
        data: { account: `${st.accountCode} ${st.accountName}`, from: st.from, to: st.to, currency, openingBalance: money(st.openingBalance), totalDebit: money(st.totalDebit), totalCredit: money(st.totalCredit), closingBalance: money(st.closingBalance), latestEntries: rows },
        display: {
          kind: "table",
          titleKey: "ai.blocks.accountStatement",
          columns: [
            { key: "date", labelKey: "ai.col.date", format: "date" },
            { key: "number", labelKey: "ai.col.number" },
            { key: "description", labelKey: "ai.col.description" },
            { key: "debit", labelKey: "ai.col.debit", format: "money" },
            { key: "credit", labelKey: "ai.col.credit", format: "money" },
            { key: "balance", labelKey: "ai.col.balance", format: "money" },
          ],
          rows,
          link: "/accounting/account-statement",
        },
      };
    },
  });

  const purchaseOrders = defineReadTool({
    name: "purchaseOrders_search",
    description: "Purchase orders, newest first, optionally by status: PENDING_APPROVAL (waiting for approval), APPROVED, PARTIALLY_RECEIVED, RECEIVED, REJECTED, CANCELLED.",
    input: z.object({ status: z.enum(["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "REJECTED", "CANCELLED"]).optional() }),
    permission: { resource: "purchase_order", action: "read" },
    run: async (ctx, input) => {
      const page = await s.purchaseOrders.list(ctx.actor.companyId, { limit: "15", ...(input.status ? { status: input.status } : {}) });
      const data = page.data.map((o) => ({ number: o.number, supplier: localName(ctx, o.supplierName, o.supplierNameAr), date: o.orderDate, status: o.status, total: money(o.totalAmount) }));
      const rows = page.data.map((o, i) => ({ ...data[i]!, _link: `/purchasing/orders/${o.id}` }));
      return {
        data,
        display: {
          kind: "table",
          titleKey: "ai.blocks.purchaseOrders",
          columns: [
            { key: "number", labelKey: "ai.col.number" },
            { key: "supplier", labelKey: "ai.col.supplier" },
            { key: "date", labelKey: "ai.col.date", format: "date" },
            { key: "status", labelKey: "ai.col.status" },
            { key: "total", labelKey: "ai.col.total", format: "money" },
          ],
          rows,
          link: "/purchasing/orders",
        },
      };
    },
  });

  const invoiceDetails = defineReadTool({
    name: "salesInvoices_get",
    description:
      "One sales invoice (or credit/debit note) by its number: customer, dates, every line (description, quantity, unit price, " +
      "net, VAT), totals, and its PDF as a file the user can open, download or print. Use when the user asks for a specific " +
      "invoice, its details, its file or its PDF. Find the number first with salesInvoices_search if the user only knows the customer.",
    input: z.object({ number: z.string().trim().min(1).max(40) }),
    permission: { resource: "sales_invoice", action: "read" },
    run: async (ctx, input) => {
      const inv = await s.prisma.salesInvoice.findFirst({
        where: { companyId: ctx.actor.companyId, number: { equals: input.number, mode: "insensitive" } },
        include: { customer: { select: { name: true, nameAr: true } }, lines: { orderBy: { lineNumber: "asc" }, select: { description: true, quantity: true, unitPrice: true, netAmount: true, taxAmount: true } } },
      });
      if (!inv) return { data: { found: false } };
      const customer = localName(ctx, inv.customer.name, inv.customer.nameAr);
      const lines = inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: money(l.unitPrice.toString()), net: money(l.netAmount.toString()), vat: money(l.taxAmount.toString()) }));
      return {
        data: {
          number: inv.number,
          type: inv.documentType,
          customer,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
          currency: inv.currency,
          totalNet: money(inv.totalNet.toString()),
          totalVat: money(inv.totalTax.toString()),
          totalGross: money(inv.totalGross.toString()),
          lines,
          pdf: "attached as a file card for the user",
        },
        display: {
          kind: "file",
          titleKey: "ai.blocks.invoiceFile",
          label: `${inv.number} — ${customer}`,
          apiPath: `/v1/sales-invoices/${inv.id}/pdf`,
          filename: inv.number,
          openPath: `/sales/invoices/${inv.id}`,
          currency: inv.currency,
          meta: [
            { labelKey: "ai.col.date", value: inv.invoiceDate.toISOString().slice(0, 10), format: "date" },
            { labelKey: "ai.kpi.net", value: money(inv.totalNet.toString()), format: "money" },
            { labelKey: "ai.kpi.vat", value: money(inv.totalTax.toString()), format: "money" },
            { labelKey: "ai.col.total", value: money(inv.totalGross.toString()), format: "money" },
          ],
        },
      };
    },
  });

  return [stockLevels, incomeStatement, balanceSheet, cashFlow, aging, partyStatement, accountStatement, purchaseOrders, invoiceDetails];
}
