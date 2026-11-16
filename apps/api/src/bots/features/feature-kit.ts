import type {
  AgingService,
  AttachmentService,
  DashboardService,
  ItemService,
  PartyService,
  PartyStatementService,
  PurchaseOrderService,
  SalesInvoiceService,
  StockLevelService,
} from "@erp/core";
import type { PrismaClient } from "@erp/db";
import type { Action, ActionRow, Block, IconKey } from "@erp/bots";
import type { SalesInvoicePdfService } from "../../sales/sales-invoice-pdf.service.js";
import type { ReceivablesExportService } from "../../payments/receivables-reports.controller.js";
import type { BotUserContext, FeatureMessage, Intent } from "../application/bot-context.js";
import type { BotLinkService } from "../application/bot-link.service.js";
import type { BotRuntime } from "../application/bot-runtime.js";

// Everything the features read or call. All of it is the same services the web endpoints use,
// so a bot answer and a screen never disagree.
export interface BotServices {
  readonly prisma: PrismaClient;
  readonly purchaseOrders: PurchaseOrderService;
  readonly parties: PartyService;
  readonly statements: PartyStatementService;
  readonly aging: AgingService;
  readonly items: ItemService;
  readonly stock: StockLevelService;
  readonly invoices: SalesInvoiceService;
  readonly dashboard: DashboardService;
  readonly invoicePdfs: SalesInvoicePdfService;
  readonly receivablesExport: ReceivablesExportService;
  readonly attachments: AttachmentService;
  readonly links: BotLinkService;
  // Set after construction (the runtime is built from the features).
  runtime: BotRuntime | null;
  readonly maxInboundFileBytes: number;
}

export function dir(ctx: BotUserContext): "rtl" | "ltr" {
  return ctx.language === "ar" ? "rtl" : "ltr";
}

export function button(label: string, action: Intent, style: "primary" | "secondary" | "success" | "danger" = "secondary", icon?: IconKey): Action<Intent> {
  return icon ? { type: "button", style, label, action, icon } : { type: "button", style, label, action };
}

export function backToMenu(ctx: BotUserContext): Action<Intent> {
  return button(ctx.t("menu.backToMenu"), { f: "menu", a: "open" }, "secondary", "menu");
}

// "Open in ERP" — only when the web address is configured.
export function openInErp(ctx: BotUserContext, path: string): Action<Intent>[] {
  const url = ctx.webUrl(path);
  return url ? [{ type: "link", label: ctx.t("common.openInErp"), url, icon: "link" }] : [];
}

export function rows(...groups: ReadonlyArray<ReadonlyArray<Action<Intent>>>): ActionRow<Intent>[] {
  return groups.filter((g) => g.length > 0).map((items) => ({ items }));
}

export function asOfFooter(ctx: BotUserContext): Block {
  return { type: "footer", text: ctx.t("common.asOf", { time: ctx.fmt.dateTime(new Date()), company: companyName(ctx) }) };
}

export function companyName(ctx: BotUserContext): string {
  return localizedName(ctx, ctx.connection.companyName, ctx.connection.companyNameAr);
}

export function card(ctx: BotUserContext, blocks: ReadonlyArray<Block>, actions: ActionRow<Intent>[] = []): FeatureMessage {
  return actions.length > 0 ? { direction: dir(ctx), blocks, actions } : { direction: dir(ctx), blocks };
}

export function localizedName(ctx: BotUserContext, name: string, nameAr: string | null): string {
  return ctx.language === "ar" && nameAr ? nameAr : name;
}

export function todayIso(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
