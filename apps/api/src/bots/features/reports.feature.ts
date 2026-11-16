import type { DashboardSections } from "@erp/core";
import { Prisma } from "@erp/db";
import type { OutboundFile, ListItem, Field } from "@erp/bots";
import { newId } from "@erp/shared";
import type { BotFeature, BotUserContext, FeatureMessage } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { asOfFooter, backToMenu, button, card, openInErp, rows, todayIso, type BotServices } from "./feature-kit.js";

// Summary reports (docs/BOTS-INTEGRATION-PLAN.md §5.6). Every number comes from DashboardService —
// the same ledger-based figures as the web dashboard — and each section is shown only to a user
// allowed to read the report behind it.

export const REPORT_TYPES = ["DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

// Broadcast audiences have no user: they get only the sections every report reader may see.
async function sectionsFor(ctx: BotUserContext): Promise<DashboardSections> {
  if (ctx.user.userId === "") {
    return { receivables: true, payables: false, profit: false, cash: false, stock: true, sales: true, purchasing: true };
  }
  const [aging, income, balance, stock, sales, purchasing] = await Promise.all([
    ctx.can("read", "aging_report"),
    ctx.can("read", "income_statement"),
    ctx.can("read", "balance_sheet"),
    ctx.can("read", "stock"),
    ctx.can("read", "sales_invoice"),
    ctx.can("read", "purchase_order"),
  ]);
  return { receivables: aging, payables: aging, profit: income, cash: balance, stock, sales, purchasing };
}

export async function buildSummary(services: BotServices, ctx: BotUserContext, type: ReportType): Promise<FeatureMessage> {
  const sections = await sectionsFor(ctx);
  const data = await services.dashboard.compute(ctx.connection.companyId, sections);
  const money = (v: string) => ctx.fmt.money(v, data.currency);
  const fields: Field[] = [];
  if (data.sales) {
    fields.push({ label: ctx.t("reports.salesThisMonth"), value: money(data.sales.thisMonthNet) });
    fields.push({ label: ctx.t("reports.openOrders"), value: String(data.sales.openOrders) });
  }
  if (data.cash) fields.push({ label: ctx.t("reports.cash"), value: data.cash.balance ? money(data.cash.balance) : "—" });
  if (data.receivables) {
    fields.push({ label: ctx.t("reports.receivables"), value: money(data.receivables.total) });
    fields.push({ label: ctx.t("reports.overdue"), value: money(data.receivables.overdue), tone: new Prisma.Decimal(data.receivables.overdue).isZero() ? "success" : "danger" });
  }
  if (data.payables) fields.push({ label: ctx.t("reports.payables"), value: money(data.payables.total) });
  if (data.stock) {
    fields.push({ label: ctx.t("reports.stockValue"), value: money(data.stock.value) });
    fields.push({ label: ctx.t("reports.belowReorder"), value: String(data.stock.belowReorder), tone: data.stock.belowReorder > 0 ? "warning" : "success" });
  }
  if (data.purchasing) fields.push({ label: ctx.t("reports.pendingApprovals"), value: String(data.purchasing.pendingApprovals), tone: data.purchasing.pendingApprovals > 0 ? "warning" : "success" });

  const blocks: FeatureMessage["blocks"][number][] = [
    { type: "header", tone: "brand", icon: "report", title: ctx.t(`reports.title.${type}`), subtitle: ctx.fmt.date(todayIso(ctx.connection.timezone)) },
    fields.length > 0 ? { type: "fields", items: fields } : { type: "text", text: ctx.t("reports.nothingPermitted"), emphasis: "muted" },
  ];
  if (type !== "DAILY_SUMMARY" && data.monthly && data.monthly.length > 0) {
    const items: ListItem[] = data.monthly.slice(-3).map((m) => ({
      icon: "chart",
      title: m.month,
      detail: `${ctx.t("reports.revenue")} ${money(m.revenue)} · ${ctx.t("reports.expense")} ${money(m.expense)}`,
    }));
    blocks.push({ type: "divider" }, { type: "list", items });
  }
  // ZATCA status today — operational counts, shown to compliance readers only.
  if (ctx.user.userId !== "" && (await ctx.can("read", "compliance"))) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const grouped = await services.prisma.zatcaInvoiceRecord.groupBy({ by: ["status"], where: { companyId: ctx.connection.companyId, updatedAt: { gte: since } }, _count: { _all: true } });
    const count = (statuses: string[]) => grouped.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);
    const ok = count(["CLEARED", "REPORTED"]);
    const bad = count(["REJECTED", "NOT_CLEARED", "FAILED"]);
    if (ok + bad > 0) {
      blocks.push({ type: "list", items: [{ icon: "zatca", tone: bad > 0 ? "danger" : "success", title: ctx.t("reports.zatca"), detail: ctx.t("reports.zatcaCounts", { ok, bad }) }] });
    }
  }
  blocks.push(asOfFooter(ctx));
  const actions = ctx.user.userId === "" ? rows(openInErp(ctx, "/")) : rows([button(ctx.t("reports.manage"), { f: "reports", a: "subscriptions" }, "secondary", "calendar"), backToMenu(ctx)], openInErp(ctx, "/"));
  return card(ctx, blocks, actions);
}

export async function agingPdf(services: BotServices, ctx: BotUserContext): Promise<OutboundFile | null> {
  if (ctx.user.userId !== "" && !(await ctx.can("read", "aging_report"))) return null;
  const today = todayIso(ctx.connection.timezone);
  const report = await services.aging.report(ctx.connection.companyId, "SALES", new Date(`${today}T00:00:00Z`));
  const file = await services.receivablesExport.aging(ctx.connection.companyId, report, "pdf", ctx.language);
  const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : new Uint8Array(file.content);
  return { fileName: file.filename, contentType: file.contentType, bytes };
}

const PRESETS: ReadonlyArray<{ readonly key: string; readonly reportType: ReportType; readonly sendTime: string; readonly weekday: number | null }> = [
  { key: "daily", reportType: "DAILY_SUMMARY", sendTime: "08:00", weekday: null },
  { key: "weekly", reportType: "WEEKLY_SUMMARY", sendTime: "08:00", weekday: 0 },
  { key: "monthly", reportType: "MONTHLY_SUMMARY", sendTime: "08:00", weekday: null },
];

export function createReportsFeature(services: BotServices): BotFeature {
  const subscriptionsCard = async (ctx: BotUserContext): Promise<FeatureMessage> => {
    const subs = await services.prisma.botSubscription.findMany({ where: { connectionId: ctx.connection.id, userId: ctx.user.userId, disabledAt: null }, orderBy: { createdAt: "asc" } });
    const active = new Set(subs.map((s) => s.reportType));
    return card(
      ctx,
      [
        { type: "header", tone: "neutral", icon: "calendar", title: ctx.t("reports.subscriptionsTitle") },
        subs.length > 0
          ? { type: "list", items: subs.map((s) => ({ icon: "report" as const, title: ctx.t(`reports.title.${s.reportType}`), detail: ctx.t("reports.at", { time: s.sendTime }) })) }
          : { type: "text", text: ctx.t("reports.noSubscriptions"), emphasis: "muted" },
      ],
      rows(
        PRESETS.filter((p) => !active.has(p.reportType)).map((p) => button(ctx.t(`reports.subscribe.${p.key}`), { f: "reports", a: "subscribe", p: { preset: p.key } }, "primary", "calendar")),
        subs.map((s) => button(`${ctx.t("reports.stop")} · ${ctx.t(`reports.title.${s.reportType}`)}`, { f: "reports", a: "unsubscribe", p: { id: s.id } }, "danger", "cross")),
        [backToMenu(ctx)],
      ),
    );
  };

  return {
    key: "reports",
    toggle: "reports",
    commands: {
      report: async (ctx) => ctx.reply(await buildSummary(services, ctx, "DAILY_SUMMARY"), "new"),
    },
    actions: {
      daily: async (ctx) => ctx.reply(await buildSummary(services, ctx, "DAILY_SUMMARY")),
      subscriptions: async (ctx) => ctx.reply(await subscriptionsCard(ctx)),
      subscribe: async (ctx, p) => {
        const preset = PRESETS.find((x) => x.key === p["preset"]);
        if (!preset) throw new BotNotice("errors.expired", {}, "info");
        const exists = await services.prisma.botSubscription.findFirst({ where: { connectionId: ctx.connection.id, userId: ctx.user.userId, reportType: preset.reportType, disabledAt: null } });
        if (!exists) {
          const id = newId();
          await services.prisma.botSubscription.create({
            data: { id, companyId: ctx.connection.companyId, connectionId: ctx.connection.id, userId: ctx.user.userId, reportType: preset.reportType, sendTime: preset.sendTime, weekday: preset.weekday, language: ctx.language, createdBy: ctx.user.userId },
          });
          await services.runtime?.auditBotAction(ctx, "bot_subscription.created", "BotSubscription", id, { reportType: preset.reportType });
        }
        await ctx.toast(ctx.t("reports.subscribed"));
        await ctx.reply(await subscriptionsCard(ctx));
      },
      unsubscribe: async (ctx, p) => {
        const sub = await services.prisma.botSubscription.findFirst({ where: { id: p["id"] ?? "", userId: ctx.user.userId, connectionId: ctx.connection.id, disabledAt: null } });
        if (sub) {
          await services.prisma.botSubscription.update({ where: { id: sub.id }, data: { disabledAt: new Date() } });
          await services.runtime?.auditBotAction(ctx, "bot_subscription.removed", "BotSubscription", sub.id, {});
        }
        await ctx.reply(await subscriptionsCard(ctx));
      },
    },
  };
}
