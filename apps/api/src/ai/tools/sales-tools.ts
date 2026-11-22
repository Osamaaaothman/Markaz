import { defineReadTool, defineWriteTool, type ErpTool, type ToolContext } from "@erp/ai";
import { resolveSalesLines, totalsOf, type QuotationService, type SalesLineInput } from "@erp/core";
import type { PrismaClient } from "@erp/db";
import { z } from "zod";

// Sales documents the assistant may prepare. It only creates a quotation (an offer: no ledger entry,
// no stock movement, cancellable). Every amount shown in the approval card comes from the same core
// line math the quotation service uses — the model never computes a total.

export interface AiSalesServices {
  readonly prisma: PrismaClient;
  readonly quotations: QuotationService;
}

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "decimal string such as 100.00");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const today = (): string => new Date().toISOString().slice(0, 10);

const lineInput = z.object({
  itemCode: z.string().trim().max(20).optional().describe("Inventory item code from items_search; omit for a service or a free-text line"),
  description: z.string().trim().max(300).optional().describe("Required when there is no itemCode"),
  quantity: decimal,
  unitPrice: decimal.describe("Price of ONE unit, excluding VAT"),
  taxCode: z.string().trim().max(20).optional().describe("Tax code from taxCodes_list; omit to use the company's only standard-rated code"),
});

const quotationInput = z.object({
  customerId: z.string().trim().min(1).describe("Customer id from parties_search (kind CUSTOMER)"),
  quotationDate: date.optional().describe("Defaults to today"),
  validUntil: date.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(lineInput).min(1).max(50),
});
type QuotationArgs = z.infer<typeof quotationInput>;

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code });

export function buildSalesTools(s: AiSalesServices): ErpTool[] {
  const listTaxCodes = defineReadTool({
    name: "taxCodes_list",
    description: "Active VAT/tax codes with their rate and treatment (STANDARD, ZERO_RATED, EXEMPT, OUT_OF_SCOPE).",
    input: z.object({}),
    permission: { resource: "quotation", action: "create" },
    run: async (ctx) => {
      const codes = await s.prisma.taxCode.findMany({ where: { companyId: ctx.actor.companyId, isActive: true }, orderBy: { code: "asc" }, select: { code: true, name: true, nameAr: true, rate: true, treatment: true } });
      const rows = codes.map((c) => ({ code: c.code, name: ctx.locale === "ar" && c.nameAr ? c.nameAr : c.name, rate: c.rate.toFixed(2), treatment: c.treatment }));
      return { data: rows };
    },
  });

  // Turns the model's codes into the ids the core service takes. Tenant-scoped, active rows only.
  async function toServiceLines(ctx: ToolContext, a: QuotationArgs): Promise<SalesLineInput[]> {
    const companyId = ctx.actor.companyId;
    const itemCodes = [...new Set(a.lines.flatMap((l) => (l.itemCode ? [l.itemCode] : [])))];
    const items = await s.prisma.item.findMany({ where: { companyId, code: { in: itemCodes }, isActive: true }, select: { id: true, code: true } });
    const taxCodes = await s.prisma.taxCode.findMany({ where: { companyId, isActive: true }, select: { id: true, code: true, treatment: true } });
    const standard = taxCodes.filter((t) => t.treatment === "STANDARD");

    return a.lines.map((l) => {
      const item = l.itemCode ? items.find((i) => i.code === l.itemCode) : undefined;
      if (l.itemCode && !item) throw fail("ITEM_NOT_FOUND", `Item ${l.itemCode} not found`);
      const given = l.taxCode ? taxCodes.find((t) => t.code === l.taxCode) : undefined;
      if (l.taxCode && !given) throw fail("TAX_CODE_NOT_FOUND", `Tax code ${l.taxCode} not found`);
      // A default is only safe when it is unambiguous; otherwise the model must ask (taxCodes_list).
      const tax = given ?? (standard.length === 1 ? standard[0] : undefined);
      if (!tax) throw fail("TAX_CODE_REQUIRED", "Several or no standard tax codes: ask the user which tax code applies");
      if (!item && !l.description) throw fail("DESCRIPTION_REQUIRED", "A line without an item needs a description");
      return {
        ...(item ? { itemId: item.id } : {}),
        ...(l.description ? { description: l.description } : {}),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxCodeId: tax.id,
      };
    });
  }

  const createQuotation = defineWriteTool({
    name: "sales_createQuotation",
    description:
      "Create a sales quotation (price offer) for a customer. Find the customer id with parties_search first; if the customer " +
      "does not exist, propose parties_createCustomer and reference its id with $ref. For each product the user names (even vaguely, " +
      "e.g. 'chairs'), call items_search first: if several items match, call clarify with their names as the options; if exactly " +
      "one matches, use it; if none match, ask whether to add it as a free-text line. Likewise, if several customers match, clarify. unitPrice is per unit and EXCLUDES VAT. If the user gives one amount for " +
      "several units, or it is unclear whether VAT is included, ask. Never compute totals yourself: the approval card shows them.",
    input: quotationInput,
    permission: { resource: "quotation", action: "create" },
    risk: "low",
    preview: async (ctx, a) => {
      const customer = await s.prisma.party.findFirst({ where: { id: a.customerId, companyId: ctx.actor.companyId }, select: { name: true, nameAr: true, kind: true } });
      const warningKeys: string[] = [];
      if (!customer) warningKeys.push("ai.warn.customerNotFound");
      let lineFields: Array<{ labelKey: string; value: string }> = [];
      let totalFields: Array<{ labelKey: string; value: string }> = [];
      try {
        const resolved = await resolveSalesLines(s.prisma, ctx.actor.companyId, await toServiceLines(ctx, a));
        lineFields = resolved.map((l) => ({
          labelKey: "ai.col.line",
          value: `${l.description} — ${l.quantity.toString()} × ${l.unitPrice.toFixed(2)} (${l.taxRate.toFixed(0)}%) = ${l.net.add(l.tax).toFixed(2)}`,
        }));
        const t = totalsOf(resolved);
        totalFields = [
          { labelKey: "ai.col.net", value: t.net.toFixed(2) },
          { labelKey: "ai.col.tax", value: t.tax.toFixed(2) },
          { labelKey: "ai.col.total", value: t.gross.toFixed(2) },
        ];
      } catch {
        warningKeys.push("ai.warn.linesInvalid");
      }
      return {
        titleKey: "ai.preview.createQuotation",
        entity: "quotation",
        fields: [
          { labelKey: "ai.col.customer", value: customer ? (ctx.locale === "ar" && customer.nameAr ? customer.nameAr : customer.name) : a.customerId },
          { labelKey: "ai.col.date", value: a.quotationDate ?? today() },
          ...(a.validUntil ? [{ labelKey: "ai.col.validUntil", value: a.validUntil }] : []),
          ...lineFields,
          ...totalFields,
          ...(a.notes ? [{ labelKey: "ai.col.notes", value: a.notes }] : []),
        ],
        ...(warningKeys.length ? { warningKeys } : {}),
      };
    },
    execute: async (ctx, a) => {
      const q = await s.quotations.create(
        {
          customerId: a.customerId,
          quotationDate: new Date(`${a.quotationDate ?? today()}T00:00:00Z`),
          ...(a.validUntil ? { validUntil: new Date(`${a.validUntil}T00:00:00Z`) } : {}),
          ...(a.notes ? { notes: a.notes } : {}),
          lines: await toServiceLines(ctx, a),
        },
        { id: ctx.actor.userId, companyId: ctx.actor.companyId },
        ctx.correlationId,
      );
      return { data: { id: q.id, number: q.number, totalGross: q.totalGross }, link: { label: q.number, path: "/sales/quotations" } };
    },
  });

  return [listTaxCodes, createQuotation];
}
