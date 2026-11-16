import { Prisma } from "@erp/db";
import { PurchaseOrderError, type PurchaseOrderDetail } from "@erp/core";
import type { BotContext, BotFeature, BotUserContext, FeatureMessage } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { asOfFooter, backToMenu, button, card, localizedName, openInErp, rows, type BotServices } from "./feature-kit.js";

// Purchase-order approvals from chat (docs/BOTS-INTEGRATION-PLAN.md §5.1). The decision goes through
// the same PurchaseOrderService.decide the web uses — same state machine, same audit record.

const PAGE_SIZE = 6;
export const PO_SUBJECT = "purchase_order";

export function approvalCard(ctx: BotUserContext, po: PurchaseOrderDetail, interactive: boolean): FeatureMessage {
  const supplier = localizedName(ctx, po.supplierName, po.supplierNameAr);
  const decided = po.status !== "PENDING_APPROVAL";
  const tone = po.status === "APPROVED" ? "success" : po.status === "REJECTED" || po.status === "CANCELLED" ? "danger" : decided ? "info" : "warning";
  const title = decided ? ctx.t(`approvals.status.${po.status}`, { defaultValue: po.status }) : ctx.t("approvals.pendingTitle");
  const actions = interactive && !decided
    ? rows(
        [
          button(ctx.t("approvals.approve"), { f: "approvals", a: "confirm", p: { id: po.id } }, "success", "check"),
          button(ctx.t("approvals.reject"), { f: "approvals", a: "reject", p: { id: po.id }, form: "reason", once: true }, "danger", "cross"),
        ],
        openInErp(ctx, `/purchasing/orders/${po.id}`),
      )
    : rows(openInErp(ctx, `/purchasing/orders/${po.id}`));
  return card(
    ctx,
    [
      { type: "header", tone, icon: "approval", title, subtitle: `${po.number} · ${supplier}` },
      {
        type: "fields",
        items: [
          {
            label: ctx.t("approvals.total"),
            value: ctx.fmt.money(new Prisma.Decimal(po.totalAmount).plus(po.totalTax).toFixed(4), po.currency),
            ...(decided ? {} : { tone: "warning" as const }),
          },
          { label: ctx.t("approvals.tax"), value: ctx.fmt.money(po.totalTax, po.currency) },
          { label: ctx.t("approvals.lines"), value: String(po.lineCount) },
          { label: ctx.t("approvals.orderDate"), value: ctx.fmt.date(po.orderDate) },
          ...(po.warehouseName ? [{ label: ctx.t("approvals.warehouse"), value: localizedName(ctx, po.warehouseName, po.warehouseNameAr) }] : []),
        ],
      },
      {
        type: "list",
        items: po.lines.slice(0, 5).map((l) => ({
          title: localizedName(ctx, l.itemName, l.itemNameAr),
          detail: `${ctx.fmt.quantity(l.quantity)} ${l.unit} × ${ctx.fmt.money(l.unitPrice, po.currency)}`,
        })),
      },
      ...(po.lines.length > 5 ? [{ type: "text" as const, text: ctx.t("approvals.moreLines", { count: po.lines.length - 5 }), emphasis: "muted" as const }] : []),
      asOfFooter(ctx),
    ],
    actions,
  );
}

async function loadOrder(services: BotServices, companyId: string, id: string): Promise<PurchaseOrderDetail> {
  try {
    return await services.purchaseOrders.get(companyId, id);
  } catch (error) {
    if (error instanceof PurchaseOrderError) throw new BotNotice("approvals.notFound");
    throw error;
  }
}

async function requireApprover(ctx: BotUserContext): Promise<void> {
  if (!(await ctx.can("approve", "purchase_order"))) throw new BotNotice("errors.forbidden", {}, "danger");
}

function aboveCeiling(ctx: BotUserContext, po: PurchaseOrderDetail): boolean {
  const ceiling = ctx.connection.approvalCeiling;
  return ceiling !== null && new Prisma.Decimal(po.totalAmount).plus(po.totalTax).greaterThan(ceiling);
}

export function createApprovalsFeature(services: BotServices): BotFeature {
  const decide = async (ctx: BotContext, id: string, decision: "APPROVED" | "REJECTED", reason?: string) => {
    await requireApprover(ctx);
    const po = await loadOrder(services, ctx.connection.companyId, id);
    if (po.status !== "PENDING_APPROVAL") throw new BotNotice("approvals.alreadyDecided", {}, "info");
    if (decision === "APPROVED" && aboveCeiling(ctx, po)) throw new BotNotice("approvals.aboveCeiling", { limit: ctx.fmt.money(ctx.connection.approvalCeiling ?? "0", po.currency) });
    try {
      await services.purchaseOrders.decide(id, decision, { id: ctx.user.userId, companyId: ctx.connection.companyId }, ctx.correlationId, reason);
    } catch (error) {
      if (error instanceof PurchaseOrderError) throw new BotNotice("approvals.alreadyDecided", {}, "info");
      throw error;
    }
    await services.runtime?.auditBotAction(ctx, decision === "APPROVED" ? "bot.purchase_order.approved" : "bot.purchase_order.rejected", "PurchaseOrder", id, {
      number: po.number,
      ...(reason ? { reason } : {}),
    });
    const after = await loadOrder(services, ctx.connection.companyId, id);
    await ctx.reply(approvalCard(ctx, after, false));
    // Every other approver who got this request sees the decision instead of live buttons.
    await services.runtime?.updateTracked(ctx.connection.companyId, PO_SUBJECT, id, (other) => Promise.resolve(approvalCard(other, after, false)));
  };

  const list = async (ctx: BotContext, page: number) => {
    await requireApprover(ctx);
    const pending = await services.prisma.purchaseOrder.findMany({
      where: { companyId: ctx.connection.companyId, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: { id: true, number: true, totalAmount: true, totalTax: true, currency: true, supplier: { select: { name: true, nameAr: true } } },
    });
    const hasMore = pending.length > PAGE_SIZE;
    const shown = pending.slice(0, PAGE_SIZE);
    if (shown.length === 0 && page === 0) {
      return ctx.reply(card(ctx, [{ type: "header", tone: "success", icon: "check", title: ctx.t("approvals.none") }, asOfFooter(ctx)], rows([backToMenu(ctx)])));
    }
    const pager = [
      ...(page > 0 ? [button(ctx.t("common.previous"), { f: "approvals", a: "list", p: { page: String(page - 1) } }, "secondary", "previous")] : []),
      ...(hasMore ? [button(ctx.t("common.next"), { f: "approvals", a: "list", p: { page: String(page + 1) } }, "secondary", "next")] : []),
    ];
    await ctx.reply(
      card(
        ctx,
        [
          { type: "header", tone: "warning", icon: "approval", title: ctx.t("approvals.listTitle") },
          { type: "text", text: ctx.t("approvals.listHint"), emphasis: "muted" },
          asOfFooter(ctx),
        ],
        rows(
          ...shown.map((o) => [
            button(
              `${o.number} · ${localizedName(ctx, o.supplier.name, o.supplier.nameAr)} · ${ctx.fmt.money(o.totalAmount.plus(o.totalTax).toFixed(4), o.currency)}`,
              { f: "approvals", a: "view", p: { id: o.id } },
              "secondary",
              "invoice",
            ),
          ]),
          pager,
          [backToMenu(ctx)],
        ),
      ),
    );
  };

  return {
    key: "approvals",
    toggle: "approvals",
    commands: {
      approvals: async (ctx) => list(ctx, 0),
    },
    forms: {
      reason: (ctx) => ({
        title: ctx.t("approvals.rejectTitle"),
        fields: [{ key: "reason", label: ctx.t("approvals.reasonLabel"), placeholder: ctx.t("approvals.reasonPlaceholder"), multiline: true, required: true, maxLength: 500 }],
      }),
    },
    actions: {
      list: async (ctx, p) => list(ctx, Math.max(0, Number.parseInt(p["page"] ?? "0", 10) || 0)),
      view: async (ctx, p) => {
        await requireApprover(ctx);
        const po = await loadOrder(services, ctx.connection.companyId, p["id"] ?? "");
        await ctx.reply(approvalCard(ctx, po, true));
        await ctx.trackLastReply(PO_SUBJECT, po.id);
      },
      // Step 1 of approving: a confirmation card with a single-use button.
      confirm: async (ctx, p) => {
        await requireApprover(ctx);
        const po = await loadOrder(services, ctx.connection.companyId, p["id"] ?? "");
        if (po.status !== "PENDING_APPROVAL") return ctx.reply(approvalCard(ctx, po, false));
        if (aboveCeiling(ctx, po)) throw new BotNotice("approvals.aboveCeiling", { limit: ctx.fmt.money(ctx.connection.approvalCeiling ?? "0", po.currency) });
        const total = ctx.fmt.money(new Prisma.Decimal(po.totalAmount).plus(po.totalTax).toFixed(4), po.currency);
        await ctx.reply(
          card(
            ctx,
            [
              { type: "header", tone: "warning", icon: "approval", title: ctx.t("approvals.confirmTitle") },
              { type: "text", text: ctx.t("approvals.confirmText", { number: po.number, total }), emphasis: "strong" },
            ],
            rows([
              button(ctx.t("approvals.confirmYes"), { f: "approvals", a: "approve", p: { id: po.id }, once: true, ttlHours: 1 }, "success", "check"),
              button(ctx.t("common.cancel"), { f: "approvals", a: "view", p: { id: po.id } }, "secondary", "back"),
            ]),
          ),
        );
      },
      approve: async (ctx, p) => decide(ctx, p["id"] ?? "", "APPROVED"),
      reject: async (ctx, p, fields) => {
        const reason = fields["reason"]?.trim();
        if (!reason) throw new BotNotice("approvals.reasonRequired");
        await decide(ctx, p["id"] ?? "", "REJECTED", reason.slice(0, 500));
      },
    },
  };
}
