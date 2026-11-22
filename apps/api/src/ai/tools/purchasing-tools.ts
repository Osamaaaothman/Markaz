import { createHash } from "node:crypto";
import { defineReadTool, defineWriteTool, type ErpTool, type ToolContext } from "@erp/ai";
import { SupplierInvoiceError, type AttachmentService, type SupplierInvoiceInput, type SupplierInvoiceService } from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { z } from "zod";
import { findChatFile } from "../ai-files.js";

// Entering a supplier invoice — typically read from a document the user attached to the chat. Posting it writes
// a journal entry (payable, input VAT, expense or goods-received), so the tool is HIGH risk: it always waits for
// the user's approval, also in auto mode. Every amount on the approval card comes from the supplier-invoice
// service's own preview; the figures read from the document are only compared against it, never posted.

export interface AiPurchasingServices {
  readonly prisma: PrismaClient;
  readonly invoices: SupplierInvoiceService;
  readonly attachments: Pick<AttachmentService, "attachStaged">;
}

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "decimal string such as 100.00");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const lineInput = z.object({
  kind: z.enum(["PO_LINE", "EXPENSE"]).describe("PO_LINE: goods ordered and received (from purchasing_invoiceableLines). EXPENSE: a service or cost posted to an account"),
  purchaseOrderLineId: z.string().trim().max(64).optional().describe("For PO_LINE: purchaseOrderLineId from purchasing_invoiceableLines"),
  accountCode: z.string().trim().max(30).optional().describe("For EXPENSE: a postable account code from accounts_search, confirmed by the user"),
  description: z.string().trim().max(300).optional(),
  quantity: decimal,
  unitPrice: decimal.describe("Price of ONE unit, excluding VAT, as written on the document"),
  taxCode: z.string().trim().max(20).optional().describe("Tax code from taxCodes_list; omit to use the company's only standard-rated code"),
});

const invoiceInput = z.object({
  supplierId: z.string().trim().min(1).describe("Supplier id from parties_search (kind SUPPLIER)"),
  supplierInvoiceNumber: z.string().trim().min(1).max(60).describe("The invoice number printed on the supplier's document"),
  invoiceDate: date,
  dueDate: date.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(lineInput).min(1).max(50),
  documentTotals: z
    .object({ net: decimal.optional(), tax: decimal.optional(), gross: decimal.optional() })
    .optional()
    .describe("The totals exactly as printed on the document, so the approval card can flag a difference. Never compute them."),
  acceptPriceVariance: z.boolean().optional().describe("Only when the user agreed that the invoice price differs from the order price"),
  sourceFileId: z.string().trim().max(20).optional().describe("The attached file id (e.g. f1a2b3c4d) to keep with the invoice"),
});
type InvoiceArgs = z.infer<typeof invoiceInput>;

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code });
const day = (d: string): Date => new Date(`${d}T00:00:00Z`);

export function buildPurchasingTools(s: AiPurchasingServices): ErpTool[] {
  const invoiceable = defineReadTool({
    name: "purchasing_invoiceableLines",
    description: "Purchase-order lines of a supplier that were received and not yet invoiced. Check this before entering a supplier invoice: goods on it should be PO_LINE lines.",
    input: z.object({ supplierId: z.string().trim().min(1) }),
    permission: { resource: "supplier_invoice", action: "create" },
    run: async (ctx, a) => {
      const rows = await s.invoices.listInvoiceable(ctx.actor.companyId, a.supplierId);
      const data = rows.map((r) => ({
        purchaseOrderLineId: r.purchaseOrderLineId,
        order: r.purchaseOrderNumber,
        item: ctx.locale === "ar" && r.itemNameAr ? r.itemNameAr : r.itemName,
        itemCode: r.itemCode,
        quantity: r.invoiceableQuantity,
        orderPrice: r.orderPrice,
      }));
      return { data };
    },
  });

  // Codes the model uses → ids the core service takes. Tenant-scoped, active rows only.
  async function toInput(ctx: ToolContext, a: InvoiceArgs): Promise<SupplierInvoiceInput> {
    const companyId = ctx.actor.companyId;
    const codes = [...new Set(a.lines.flatMap((l) => (l.accountCode ? [l.accountCode] : [])))];
    const accounts = await s.prisma.account.findMany({ where: { companyId, code: { in: codes } }, select: { id: true, code: true, isActive: true, isPostable: true } });
    const taxCodes = await s.prisma.taxCode.findMany({ where: { companyId, isActive: true }, select: { id: true, code: true, treatment: true } });
    const standard = taxCodes.filter((t) => t.treatment === "STANDARD");
    const lines = a.lines.map((l) => {
      const given = l.taxCode ? taxCodes.find((t) => t.code === l.taxCode) : undefined;
      if (l.taxCode && !given) throw fail("TAX_CODE_NOT_FOUND", `Tax code ${l.taxCode} not found`);
      const tax = given ?? (standard.length === 1 ? standard[0] : undefined);
      if (!tax) throw fail("TAX_CODE_REQUIRED", "Several or no standard tax codes: ask the user which tax code applies");
      if (l.kind === "PO_LINE") {
        if (!l.purchaseOrderLineId) throw fail("PO_LINE_REQUIRED", "A PO_LINE line needs purchaseOrderLineId from purchasing_invoiceableLines");
        return { kind: "PO_LINE" as const, purchaseOrderLineId: l.purchaseOrderLineId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: tax.id };
      }
      const account = accounts.find((x) => x.code === l.accountCode);
      if (!account) throw fail("ACCOUNT_REQUIRED", "An EXPENSE line needs a postable account code (accounts_search); ask the user which account");
      if (!account.isPostable) throw fail("ACCOUNT_NOT_POSTABLE", `Account ${account.code} is a group account; choose one of its detail accounts (accounts_search, group "no")`);
      if (!account.isActive) throw fail("ACCOUNT_INACTIVE", `Account ${account.code} is inactive`);
      return { kind: "EXPENSE" as const, accountId: account.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: tax.id };
    });
    return {
      supplierId: a.supplierId,
      supplierInvoiceNumber: a.supplierInvoiceNumber,
      invoiceDate: day(a.invoiceDate),
      ...(a.dueDate ? { dueDate: day(a.dueDate) } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      ...(a.acceptPriceVariance ? { acceptPriceVariance: true } : {}),
      lines,
    };
  }

  const createInvoice = defineWriteTool({
    name: "purchasing_createSupplierInvoice",
    description:
      "Enter and post a supplier (purchase) invoice, usually read from a document the user attached. Steps: find the supplier with " +
      "parties_search (if several match, clarify; if none, propose parties_createSupplier and use $ref). Call purchasing_invoiceableLines: " +
      "goods that were ordered and received go as PO_LINE lines. When only a line total is printed, use unitPrice = total ÷ quantity with 4 decimals (e.g. 2500 ÷ 30 = 83.3333) and keep the printed quantity; never change the quantity to make totals match. Other lines are EXPENSE lines and need an account: suggest one with " +
      "accounts_search (only accounts with group \"no\" can be posted to; for services and costs prefer EXPENSE accounts) and let the user confirm it — never pick an account silently. If the document shows no VAT, ask which tax code applies (taxCodes_list) instead of assuming. Copy numbers exactly as printed (unit price " +
      "excluding VAT); if the document is unreadable or a required detail (invoice number, date, supplier) is missing, ask. Pass the " +
      "document's own totals in documentTotals and its file id in sourceFileId. Never compute totals yourself.",
    input: invoiceInput,
    permission: { resource: "supplier_invoice", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const companyId = ctx.actor.companyId;
      const supplier = await s.prisma.party.findFirst({ where: { id: a.supplierId, companyId }, select: { name: true, nameAr: true } });
      const warningKeys: string[] = [];
      if (!supplier) warningKeys.push("ai.warn.supplierNotFound");
      const duplicate = await s.prisma.supplierInvoice.findFirst({ where: { companyId, supplierId: a.supplierId, supplierInvoiceNumber: a.supplierInvoiceNumber }, select: { id: true } });
      if (duplicate) warningKeys.push("ai.warn.duplicateInvoice");
      const file = a.sourceFileId && ctx.conversationId ? await findChatFile(s.prisma, companyId, ctx.conversationId, a.sourceFileId) : null;
      if (a.sourceFileId && !file) warningKeys.push("ai.warn.fileNotFound");

      let lineFields: Array<{ labelKey: string; value: string }> = [];
      let totalFields: Array<{ labelKey: string; value: string }> = [];
      try {
        const p = await s.invoices.preview(await toInput(ctx, a), { id: ctx.actor.userId, companyId });
        lineFields = p.lines.map((l) => ({ labelKey: "ai.col.line", value: `${l.description} — ${l.quantity} × ${l.unitPrice} (${l.taxRate}%) = ${new Prisma.Decimal(l.net).add(l.tax).toFixed(2)}` }));
        totalFields = [
          { labelKey: "ai.col.net", value: new Prisma.Decimal(p.totalNet).toFixed(2) },
          { labelKey: "ai.col.tax", value: new Prisma.Decimal(p.totalTax).toFixed(2) },
          { labelKey: "ai.col.total", value: new Prisma.Decimal(p.totalGross).toFixed(2) },
        ];
        if (p.hasPriceVariance) warningKeys.push(a.acceptPriceVariance ? "ai.warn.priceVarianceAccepted" : "ai.warn.priceVariance");
        if (!p.canPost) warningKeys.push("ai.warn.qtyExceedsReceived");
        // The document's printed totals against the system's, at the printed (2-decimal) precision: a
        // unit price such as 83.3333 gives 2499.999 internally, which IS the printed 2500.00.
        const t = a.documentTotals;
        const cents = (v: string): Prisma.Decimal => new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const differs = (printed: string | undefined, ours: string): boolean => printed !== undefined && !cents(printed).equals(cents(ours));
        if (t && (differs(t.net, p.totalNet) || differs(t.tax, p.totalTax) || differs(t.gross, p.totalGross))) warningKeys.push("ai.warn.totalsMismatch");
      } catch (error) {
        // Show the actual reason (e.g. a group account, no tax code) next to the generic note.
        const code = (error as { code?: unknown }).code;
        warningKeys.push("ai.warn.linesInvalid", ...(typeof code === "string" ? [`ai.error.${code}`] : []));
      }
      const t = a.documentTotals;
      return {
        titleKey: "ai.preview.createSupplierInvoice",
        entity: "supplier_invoice",
        fields: [
          { labelKey: "ai.col.supplier", value: supplier ? (ctx.locale === "ar" && supplier.nameAr ? supplier.nameAr : supplier.name) : a.supplierId },
          { labelKey: "ai.col.supplierInvoiceNumber", value: a.supplierInvoiceNumber },
          { labelKey: "ai.col.date", value: a.invoiceDate },
          ...(a.dueDate ? [{ labelKey: "ai.col.dueDate", value: a.dueDate }] : []),
          ...lineFields,
          ...totalFields,
          ...(t?.gross ? [{ labelKey: "ai.col.documentTotal", value: t.gross }] : []),
          ...(file ? [{ labelKey: "ai.col.attachment", value: file.originalName }] : []),
          ...(a.notes ? [{ labelKey: "ai.col.notes", value: a.notes }] : []),
        ],
        ...(warningKeys.length ? { warningKeys } : {}),
      };
    },
    execute: async (ctx, a) => {
      const companyId = ctx.actor.companyId;
      const actor = { id: ctx.actor.userId, companyId };
      // Same approval run twice (retry, double click) → same key → the ledger refuses a second entry.
      const idempotencyKey = `ai-${createHash("sha256").update(`${ctx.conversationId ?? ""}|${JSON.stringify(a)}`).digest("hex").slice(0, 40)}`;
      let invoice;
      try {
        invoice = await s.invoices.create(await toInput(ctx, a), actor, ctx.correlationId, idempotencyKey);
      } catch (error) {
        if (error instanceof SupplierInvoiceError) throw fail(error.code, error.message);
        throw error;
      }
      // The invoice is posted at this point; a failed attachment must not report the posting as failed.
      let attached = false;
      const file = a.sourceFileId && ctx.conversationId ? await findChatFile(s.prisma, companyId, ctx.conversationId, a.sourceFileId) : null;
      if (file) {
        try {
          await s.attachments.attachStaged(file, "SUPPLIER_INVOICE", invoice.id, actor, ctx.correlationId);
          attached = true;
        } catch {
          attached = false;
        }
      }
      return {
        data: { id: invoice.id, number: invoice.number, totalGross: invoice.totalGross, fileAttached: attached },
        link: { label: invoice.number, path: `/purchasing/invoices/${invoice.id}` },
      };
    },
  });

  return [invoiceable, createInvoice];
}
