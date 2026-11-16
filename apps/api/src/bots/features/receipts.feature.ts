import { AdapterError } from "@erp/bots";
import { AttachmentError } from "@erp/core";
import type { Action } from "@erp/bots";
import type { BotFeature, Intent } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { backToMenu, button, card, localizedName, openInErp, rows, type BotServices } from "./feature-kit.js";

// Files in (docs/BOTS-INTEGRATION-PLAN.md §5.5): a photo or PDF sent to the bot is attached to a
// record the user picks, through the same AttachmentService (type sniffing, size limit, permission
// per record type) as an upload from the web. Never creates a financial record.

const CHOICES = 5;

export function createReceiptsFeature(services: BotServices): BotFeature {
  return {
    key: "receipts",
    toggle: "receipts",
    onFile: async (ctx) => {
      if (ctx.event.kind !== "file") return;
      if (!(await ctx.can("create", "attachment"))) throw new BotNotice("errors.forbidden", {}, "danger");
      const file = ctx.event.file;
      if (file.size !== undefined && file.size > services.maxInboundFileBytes) throw new BotNotice("receipts.tooLarge");
      const fileParams: Record<string, string> = {
        fileId: file.fileId,
        fileName: file.fileName,
        ...(file.url ? { url: file.url } : {}),
        ...(file.contentType ? { contentType: file.contentType } : {}),
        ...(file.size !== undefined ? { size: String(file.size) } : {}),
      };
      const companyId = ctx.connection.companyId;
      const [supplierInvoices, orders] = await Promise.all([
        ctx.can("read", "supplier_invoice").then((ok) =>
          ok
            ? services.prisma.supplierInvoice.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: CHOICES, select: { id: true, number: true, supplier: { select: { name: true, nameAr: true } } } })
            : [],
        ),
        ctx.can("read", "purchase_order").then((ok) =>
          ok
            ? services.prisma.purchaseOrder.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: CHOICES, select: { id: true, number: true, supplier: { select: { name: true, nameAr: true } } } })
            : [],
        ),
      ]);
      const option = (ownerType: string, ownerId: string, label: string): Action<Intent>[] => [
        button(label, { f: "receipts", a: "attach", p: { ...fileParams, ownerType, ownerId }, once: true, ttlHours: 2 }, "secondary", "file"),
      ];
      const choices = [
        ...supplierInvoices.map((s) => option("SUPPLIER_INVOICE", s.id, `${s.number} · ${localizedName(ctx, s.supplier.name, s.supplier.nameAr)}`)),
        ...orders.map((o) => option("PURCHASE_ORDER", o.id, `${o.number} · ${localizedName(ctx, o.supplier.name, o.supplier.nameAr)}`)),
      ];
      if (choices.length === 0) throw new BotNotice("receipts.noRecords", {}, "info");
      await ctx.reply(
        card(
          ctx,
          [
            { type: "header", tone: "info", icon: "file", title: ctx.t("receipts.chooseTitle"), subtitle: file.fileName },
            { type: "text", text: ctx.t("receipts.chooseHint"), emphasis: "muted" },
          ],
          rows(...choices, [backToMenu(ctx)]),
        ),
        "new",
      );
    },
    actions: {
      attach: async (ctx, p) => {
        const ownerType = p["ownerType"] ?? "";
        const ownerId = p["ownerId"] ?? "";
        const fileName = p["fileName"] ?? "file";
        let bytes: Uint8Array;
        try {
          bytes = await ctx.adapter.downloadFile(
            {
              fileId: p["fileId"] ?? "",
              fileName,
              ...(p["url"] ? { url: p["url"] } : {}),
              ...(p["contentType"] ? { contentType: p["contentType"] } : {}),
              ...(p["size"] ? { size: Number(p["size"]) } : {}),
            },
            ctx.secrets,
            services.maxInboundFileBytes,
          );
        } catch (error) {
          if (error instanceof AdapterError && error.code === "TOO_LARGE") throw new BotNotice("receipts.tooLarge");
          if (error instanceof AdapterError) throw new BotNotice("receipts.downloadFailed");
          throw error;
        }
        try {
          await services.attachments.upload({ ownerType, ownerId, fileName, bytes }, { id: ctx.user.userId, companyId: ctx.connection.companyId }, ctx.correlationId);
        } catch (error) {
          if (error instanceof AttachmentError) {
            const key = error.code === "UNSUPPORTED_FILE_TYPE" ? "receipts.unsupported" : error.code === "FILE_TOO_LARGE" ? "receipts.tooLarge" : error.code === "FORBIDDEN_OWNER" ? "errors.forbidden" : "receipts.failed";
            throw new BotNotice(key);
          }
          throw error;
        }
        const path = ownerType === "SUPPLIER_INVOICE" ? `/purchasing/invoices/${ownerId}` : `/purchasing/orders/${ownerId}`;
        await ctx.reply(
          card(ctx, [{ type: "header", tone: "success", icon: "check", title: ctx.t("receipts.attached"), subtitle: fileName }], rows(openInErp(ctx, path), [backToMenu(ctx)])),
        );
      },
    },
  };
}
