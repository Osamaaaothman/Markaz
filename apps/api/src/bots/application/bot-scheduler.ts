import type { PrismaClient } from "@erp/db";
import { Prisma } from "@erp/db";
import { AdapterError } from "@erp/bots";
import type { BotUserContext, FeatureMessage } from "./bot-context.js";
import { inQuietHours, zonedClock } from "./bot-format.js";
import type { BotLogger, BotRuntime } from "./bot-runtime.js";
import type { AlertType } from "../features/alert-types.js";
import { PO_SUBJECT, approvalCard } from "../features/approvals.feature.js";
import { agingPdf, buildSummary, type ReportType } from "../features/reports.feature.js";
import { asOfFooter, card, localizedName, openInErp, rows, type BotServices } from "../features/feature-kit.js";

// Proactive messages: alerts found by a periodic scan, and scheduled reports
// (docs/BOTS-INTEGRATION-PLAN.md §5.2, §5.6, §10). The scan writes a bot_alert_marks row before
// queueing a message, so an alert is sent once even with several API replicas running the scan.

export type DeliveryJob =
  | { readonly kind: "alert"; readonly alertType: AlertType; readonly connectionId: string; readonly userId: string; readonly companyId: string; readonly subjectIds: ReadonlyArray<string> }
  | { readonly kind: "report"; readonly subscriptionId: string; readonly periodKey: string };

export interface DeliveryQueue {
  enqueue(job: DeliveryJob, delayMs: number, jobId: string): Promise<void>;
}

const APPROVAL_LOOKBACK_MS = 7 * 24 * 3600_000;
const ZATCA_LOOKBACK_MS = 3 * 24 * 3600_000;
const REPORT_WINDOW_MINUTES = 60;
// Critical alerts ignore quiet hours.
const CRITICAL: ReadonlySet<AlertType> = new Set(["zatca_problem"]);

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function minutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesUntil(fromHhmm: string, toHhmm: string): number {
  const diff = minutes(toHhmm) - minutes(fromHhmm);
  return diff >= 0 ? diff : diff + 24 * 60;
}

export class BotScheduler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly runtime: BotRuntime,
    private readonly services: BotServices,
    private readonly queue: DeliveryQueue,
    private readonly logger: BotLogger,
  ) {}

  // ── scan (runs every minute) ──────────────────────────────────────────────────────────────

  async tick(now: Date = new Date()): Promise<void> {
    const connections = await this.prisma.botConnection.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, companyId: true, enabledFeatures: true, company: { select: { timezone: true } } },
    });
    for (const connection of connections) {
      try {
        if (connection.enabledFeatures.includes("alerts")) await this.scanAlerts(connection.id, connection.companyId, connection.company.timezone, now);
        if (connection.enabledFeatures.includes("reports")) await this.scanReports(connection.id, connection.company.timezone, now);
      } catch (error) {
        this.logger.error({ connectionId: connection.id, err: error instanceof Error ? error.message : String(error) }, "bot.scan_failed");
      }
    }
  }

  private async mark(companyId: string, alertType: AlertType, subjectKey: string): Promise<boolean> {
    try {
      await this.prisma.botAlertMark.create({ data: { companyId, alertType, subjectKey } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  // Linked users of this connection who may see the alert and have not muted it.
  private async recipients(connectionId: string, alertType: AlertType, action: string, resource: string) {
    const links = await this.prisma.botIdentityLink.findMany({
      where: { connectionId, revokedAt: null, unreachableAt: null, user: { isActive: true } },
      select: { userId: true, disabledAlerts: true, quietHoursStart: true, quietHoursEnd: true },
    });
    const out: typeof links = [];
    for (const link of links) {
      if (link.disabledAlerts.includes(alertType)) continue;
      if (await this.runtime.can(link.userId, action, resource)) out.push(link);
    }
    return out;
  }

  private async dispatch(connectionId: string, companyId: string, timezone: string, now: Date, alertType: AlertType, subjectIds: string[], action: string, resource: string, exclude: string | null): Promise<void> {
    if (subjectIds.length === 0) return;
    const clock = zonedClock(now, timezone).hhmm;
    for (const link of await this.recipients(connectionId, alertType, action, resource)) {
      if (link.userId === exclude) continue;
      let delayMs = 0;
      if (!CRITICAL.has(alertType) && inQuietHours(clock, link.quietHoursStart, link.quietHoursEnd) && link.quietHoursEnd) {
        delayMs = minutesUntil(clock, link.quietHoursEnd) * 60_000;
      }
      await this.queue.enqueue(
        { kind: "alert", alertType, connectionId, companyId, userId: link.userId, subjectIds },
        delayMs,
        `alert:${connectionId}:${alertType}:${link.userId}:${subjectIds.join(",").slice(0, 200)}`,
      );
    }
  }

  private async scanAlerts(connectionId: string, companyId: string, timezone: string, now: Date): Promise<void> {
    // 1. Purchase orders waiting for approval — one message per order.
    const pending = await this.prisma.purchaseOrder.findMany({
      where: { companyId, status: "PENDING_APPROVAL", createdAt: { gte: new Date(now.getTime() - APPROVAL_LOOKBACK_MS) } },
      select: { id: true, requestedBy: true },
    });
    for (const po of pending) {
      if (await this.mark(companyId, "approval_requested", `${connectionId}:${po.id}`)) {
        await this.dispatch(connectionId, companyId, timezone, now, "approval_requested", [po.id], "approve", "purchase_order", po.requestedBy);
      }
    }

    // 2. Stock below reorder point — one digest of the newly low items. A mark is cleared when the
    // item recovers, so it alerts again the next time it runs low.
    const low = await this.services.stock.list(companyId, { belowReorderOnly: "true" });
    const lowKeys = new Set(low.map((l) => `${connectionId}:${l.itemId}:${l.warehouseId}`));
    const existing = await this.prisma.botAlertMark.findMany({ where: { companyId, alertType: "low_stock", subjectKey: { startsWith: `${connectionId}:` } }, select: { subjectKey: true } });
    const recovered = existing.map((m) => m.subjectKey).filter((k) => !lowKeys.has(k));
    if (recovered.length > 0) await this.prisma.botAlertMark.deleteMany({ where: { companyId, alertType: "low_stock", subjectKey: { in: recovered } } });
    const newlyLow: string[] = [];
    for (const entry of low) if (await this.mark(companyId, "low_stock", `${connectionId}:${entry.itemId}:${entry.warehouseId}`)) newlyLow.push(`${entry.itemId}:${entry.warehouseId}`);
    await this.dispatch(connectionId, companyId, timezone, now, "low_stock", newlyLow, "read", "stock", null);

    // 3. ZATCA rejections / failures — critical, sent even in quiet hours.
    const problems = await this.prisma.zatcaInvoiceRecord.findMany({
      where: { companyId, status: { in: ["REJECTED", "NOT_CLEARED", "FAILED"] }, updatedAt: { gte: new Date(now.getTime() - ZATCA_LOOKBACK_MS) } },
      select: { id: true, status: true },
    });
    const newProblems: string[] = [];
    for (const record of problems) if (await this.mark(companyId, "zatca_problem", `${connectionId}:${record.id}:${record.status}`)) newProblems.push(record.id);
    await this.dispatch(connectionId, companyId, timezone, now, "zatca_problem", newProblems, "read", "compliance", null);
  }

  private async scanReports(connectionId: string, timezone: string, now: Date): Promise<void> {
    const clock = zonedClock(now, timezone);
    const subs = await this.prisma.botSubscription.findMany({ where: { connectionId, disabledAt: null } });
    for (const sub of subs) {
      const elapsed = minutes(clock.hhmm) - minutes(sub.sendTime);
      if (elapsed < 0 || elapsed >= REPORT_WINDOW_MINUTES) continue;
      let periodKey: string;
      if (sub.reportType === "DAILY_SUMMARY") periodKey = clock.date;
      else if (sub.reportType === "WEEKLY_SUMMARY") {
        if (clock.weekday !== (sub.weekday ?? 0)) continue;
        periodKey = clock.date;
      } else {
        if (clock.day !== 1) continue;
        periodKey = clock.date.slice(0, 7);
      }
      // Claim the period first so two replicas never both send it.
      const claimed = await this.prisma.botSubscription.updateMany({
        where: { id: sub.id, OR: [{ lastPeriodKey: null }, { lastPeriodKey: { not: periodKey } }] },
        data: { lastPeriodKey: periodKey },
      });
      if (claimed.count === 1) await this.queue.enqueue({ kind: "report", subscriptionId: sub.id, periodKey }, 0, `report:${sub.id}:${periodKey}`);
    }
  }

  // ── delivery (bot-delivery queue consumer) ───────────────────────────────────────────────

  async deliver(job: DeliveryJob): Promise<void> {
    if (job.kind === "report") return this.deliverReport(job.subscriptionId);
    const build = async (ctx: BotUserContext) => {
      switch (job.alertType) {
        case "approval_requested":
          return this.approvalAlert(ctx, job.subjectIds[0] ?? "");
        case "low_stock":
          return this.lowStockAlert(ctx, job.subjectIds);
        case "zatca_problem":
          return this.zatcaAlert(ctx, job.subjectIds);
      }
    };
    const track = job.alertType === "approval_requested" && job.subjectIds[0] ? { subjectType: PO_SUBJECT, subjectId: job.subjectIds[0] } : undefined;
    await this.runtime.sendToUser(job.connectionId, job.userId, `alert.${job.alertType}`, build, track);
  }

  private async approvalAlert(ctx: BotUserContext, id: string): Promise<{ message: FeatureMessage } | null> {
    if (!ctx.featureEnabled("alerts")) return null;
    const po = await this.services.purchaseOrders.get(ctx.connection.companyId, id).catch(() => null);
    if (!po || po.status !== "PENDING_APPROVAL") return null;
    // Interactive buttons only when this connection allows approvals from chat.
    return { message: approvalCard(ctx, po, ctx.featureEnabled("approvals")) };
  }

  private async lowStockAlert(ctx: BotUserContext, keys: ReadonlyArray<string>): Promise<{ message: FeatureMessage } | null> {
    const levels = await this.services.stock.list(ctx.connection.companyId, { belowReorderOnly: "true" });
    const wanted = new Set(keys);
    const entries = levels.filter((l) => wanted.has(`${l.itemId}:${l.warehouseId}`));
    if (entries.length === 0) return null;
    return {
      message: card(
        ctx,
        [
          { type: "header", tone: "warning", icon: "stock", title: ctx.t("alerts.lowStockTitle", { count: entries.length }) },
          {
            type: "list",
            items: entries.slice(0, 15).map((l) => ({
              tone: "warning" as const,
              title: `${l.itemCode} · ${localizedName(ctx, l.itemName, l.itemNameAr)}`,
              detail: ctx.t("alerts.lowStockLine", { warehouse: localizedName(ctx, l.warehouseName, l.warehouseNameAr), quantity: ctx.fmt.quantity(l.quantity), reorder: ctx.fmt.quantity(l.reorderPoint) }),
            })),
          },
          asOfFooter(ctx),
        ],
        rows(openInErp(ctx, "/inventory/stock-levels"), openInErp(ctx, "/purchasing/requests").map((a) => (a.type === "link" ? { ...a, label: ctx.t("alerts.createRequest") } : a))),
      ),
    };
  }

  private async zatcaAlert(ctx: BotUserContext, recordIds: ReadonlyArray<string>): Promise<{ message: FeatureMessage } | null> {
    const records = await this.prisma.zatcaInvoiceRecord.findMany({
      where: { id: { in: [...recordIds] }, companyId: ctx.connection.companyId },
      select: { status: true, salesInvoiceId: true, salesInvoice: { select: { number: true } } },
    });
    if (records.length === 0) return null;
    return {
      message: card(
        ctx,
        [
          { type: "header", tone: "danger", icon: "zatca", title: ctx.t("alerts.zatcaTitle", { count: records.length }) },
          { type: "list", items: records.map((r) => ({ tone: "danger" as const, title: r.salesInvoice.number, detail: ctx.t(`lookups.zatcaStatus.${r.status}`, { defaultValue: r.status }) })) },
          { type: "text", text: ctx.t("alerts.zatcaHint"), emphasis: "muted" },
          asOfFooter(ctx),
        ],
        rows(openInErp(ctx, "/settings/zatca"), records.length === 1 && records[0] ? openInErp(ctx, `/sales/invoices/${records[0].salesInvoiceId}`) : []),
      ),
    };
  }

  private async deliverReport(subscriptionId: string): Promise<void> {
    const sub = await this.prisma.botSubscription.findUnique({ where: { id: subscriptionId }, include: { broadcastTarget: true } });
    if (!sub || sub.disabledAt) return;
    const type = sub.reportType as ReportType;
    const build = async (ctx: BotUserContext) => {
      if (!ctx.featureEnabled("reports")) return null;
      const message = await buildSummary(this.services, ctx, type);
      const file = sub.attachPdf ? await agingPdf(this.services, ctx) : null;
      return file ? { message, file } : { message };
    };
    if (sub.userId) {
      await this.runtime.sendToUser(sub.connectionId, sub.userId, `report.${type}`, build);
    } else if (sub.broadcastTarget && !sub.broadcastTarget.disabledAt) {
      await this.runtime.sendToChat(sub.connectionId, sub.broadcastTarget.chatId, sub.language === "ar" ? "ar" : "en", `report.${type}`, build);
    }
  }

  // ── health + housekeeping ─────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<void> {
    const connections = await this.prisma.botConnection.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    for (const { id } of connections) {
      const loaded = await this.runtime.loadConnection(id);
      if (!loaded) continue;
      let ok = false;
      let code: string | null = null;
      try {
        const result = await loaded.adapter.testConnection(loaded.secrets);
        ok = result.ok;
        code = result.ok ? null : result.code;
      } catch (error) {
        code = error instanceof AdapterError ? error.code : "INTERNAL";
      }
      await this.prisma.botConnection.update({ where: { id }, data: { lastHealthAt: new Date(), lastHealthOk: ok, lastHealthCode: code } });
      if (!ok) this.logger.warn({ connectionId: id, code }, "bot.health_failed");
    }
  }

  async cleanup(now: Date = new Date()): Promise<void> {
    const day = 24 * 3600_000;
    await this.prisma.botActionToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } });
    await this.prisma.botInboundEvent.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 3 * day) } } });
    await this.prisma.botChatSession.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.prisma.botLinkCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } });
    await this.prisma.botSentMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * day) } } });
    await this.prisma.botDeliveryLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * day) } } });
    // Approval marks older than the lookback can go; the order itself is no longer scanned.
    await this.prisma.botAlertMark.deleteMany({ where: { alertType: { in: ["approval_requested", "zatca_problem"] }, createdAt: { lt: new Date(now.getTime() - 30 * day) } } });
  }
}
