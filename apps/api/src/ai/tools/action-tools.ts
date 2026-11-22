import { createHash } from "node:crypto";
import { HttpException, type Type } from "@nestjs/common";
import type { ModuleRef } from "@nestjs/core";
import { defineWriteTool, type ErpTool, type ToolContext, type ToolRisk, type ChangePreview } from "@erp/ai";
import { resolveSalesLines, totalsOf } from "@erp/core";
import { Prisma, type PrismaClient } from "@erp/db";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { z } from "zod";
import type { CurrentUserPayload } from "../../auth/current-user.decorator.js";
import { AccountingController } from "../../accounting/accounting.controller.js";
import { PostJournalEntryDto } from "../../accounting/dto/post-journal-entry.dto.js";
import { ReverseJournalEntryDto } from "../../accounting/dto/reverse-journal-entry.dto.js";
import { FixedAssetsController } from "../../fixed-assets/fixed-assets.controller.js";
import { CapitalizeAssetDto, DepreciationPeriodDto, FixedAssetDetailsDto } from "../../fixed-assets/dto/fixed-asset-dtos.js";
import { HrController } from "../../hr/hr.controller.js";
import { CreatePayrollRunDto, GrantSalaryAdvanceDto } from "../../hr/dto/hr-dtos.js";
import { InventoryController } from "../../inventory/inventory.controller.js";
import { CreateStockIssueDto } from "../../inventory/dto/create-stock-issue.dto.js";
import { UpdateItemDto } from "../../inventory/dto/update-item.dto.js";
import { UpdateWarehouseDto } from "../../inventory/dto/update-warehouse.dto.js";
import { PartiesController } from "../../parties/parties.controller.js";
import { UpdatePartyDto } from "../../parties/dto/update-party.dto.js";
import { PaymentsController } from "../../payments/payments.controller.js";
import { CreatePaymentDto } from "../../payments/dto/payment-dtos.js";
import { InvoicingController } from "../../purchasing/invoicing.controller.js";
import { CreateDebitNoteDto as SupplierDebitNoteDto } from "../../purchasing/dto/invoice-dtos.js";
import { PurchasingController } from "../../purchasing/purchasing.controller.js";
import { CreatePurchaseOrderDto, CreatePurchaseRequestDto, DecidePurchaseOrderDto, ReceivePurchaseOrderDto } from "../../purchasing/dto/purchasing-dtos.js";
import { SalesController } from "../../sales/sales.controller.js";
import {
  ConvertQuotationDto,
  CreateCreditNoteDto,
  CreateDebitNoteDto,
  CreateGoodsDeliveryNoteDto,
  CreateSalesInvoiceDto,
  CreateSalesOrderDto,
} from "../../sales/dto/sales-dtos.js";

// ─── How these tools work ────────────────────────────────────────────────────────────────────────
// Every action here goes through the SAME controller method the web page calls: the DTO is checked
// with the same class-validator rules, the controller maps the same domain errors, and the service
// writes the journal entry / stock movement / document number / audit record exactly as it does for
// a click on the page. The tool only turns what the model says (codes, numbers) into the ids the DTO
// needs, and builds the approval card. Nothing here computes a ledger amount: totals on the cards come
// from the core line math or from the stored document.
//
// Every action here that moves money, stock or the ledger is "high" risk: it always waits for the
// user's approval, even in auto mode (packages/ai/src/tools/policy.ts).

export interface AiActionServices {
  readonly prisma: PrismaClient;
  readonly moduleRef: ModuleRef;
}

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "decimal string such as 100.00");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const today = (): string => new Date().toISOString().slice(0, 10);
const D = (v: string | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(v);

export const actionError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

type Field = { labelKey: string; value: string };
const field = (labelKey: string, value: string | null | undefined): Field[] => (value ? [{ labelKey, value }] : []);

// The controller's own exceptions carry { code, message }; keep the code, drop the HTTP wrapper.
function unwrap(error: unknown): Error {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: unknown; message?: unknown } | string;
    const code = typeof body === "object" && typeof body.code === "string" ? body.code : `HTTP_${error.getStatus()}`;
    const message = typeof body === "object" && typeof body.message === "string" ? body.message : error.message;
    return actionError(code, message);
  }
  return error instanceof Error ? error : actionError("TOOL_FAILED", String(error));
}

// Same rules as the global ValidationPipe (main.ts): whitelist, forbid unknown fields, transform.
async function toDto<T extends object>(cls: Type<T>, body: object): Promise<T> {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const first = errors[0]!;
    const detail = Object.values(first.constraints ?? {})[0] ?? (first.children?.length ? "invalid nested value" : "invalid");
    throw actionError("INVALID_INPUT", `${first.property}: ${detail}`);
  }
  return dto;
}

// A key that makes a retried approval post once: same decision (correlation id) + tool + input → same
// key. A later, separate request for an identical document gets a new key, so it is not swallowed.
const keyOf = (ctx: ToolContext, tool: string, args: unknown): string =>
  `ai-${createHash("sha256").update(`${ctx.conversationId}|${ctx.correlationId}|${tool}|${JSON.stringify(args)}`).digest("hex").slice(0, 40)}`;

// A copy of `o` without `key` (the model's lookup field is not part of the DTO).
function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

const actorOf = (ctx: ToolContext): CurrentUserPayload => ({ id: ctx.actor.userId, companyId: ctx.actor.companyId });

export function buildActionTools(s: AiActionServices): ErpTool[] {
  const { prisma } = s;
  const controller = <C>(cls: Type<C>): C => s.moduleRef.get(cls, { strict: false });
  const run = async <R>(work: () => Promise<R>): Promise<R> => {
    try {
      return await work();
    } catch (error) {
      throw unwrap(error);
    }
  };
  const name = (ctx: ToolContext, r: { name: string; nameAr?: string | null }): string => (ctx.locale === "ar" && r.nameAr ? r.nameAr : r.name);

  // ─── Resolvers: model words → tenant-scoped ids ────────────────────────────────────────────────
  // A document is named by its id or its number (QUO-000012); never by another company's row.
  type DocModel = "quotation" | "salesOrder" | "salesInvoice" | "payment" | "purchaseOrder" | "supplierInvoice" | "journalEntry" | "fixedAsset";
  async function doc(ctx: ToolContext, model: DocModel, ref: string): Promise<{ id: string; number: string; status?: string }> {
    const where = { companyId: ctx.actor.companyId, OR: [{ id: ref }, { number: ref }] };
    const select = { id: true, number: true };
    // Each delegate has the same (id, number) shape; the union of delegates is not callable as one type.
    const delegate = prisma[model] as unknown as { findFirst(a: { where: typeof where; select: Record<string, boolean> }): Promise<{ id: string; number: string; status?: string } | null> };
    const hasStatus = model === "quotation" || model === "salesOrder" || model === "purchaseOrder" || model === "fixedAsset";
    const row = await delegate.findFirst({ where, select: hasStatus ? { ...select, status: true } : select });
    if (!row) throw actionError("DOCUMENT_NOT_FOUND", `${model} ${ref} not found`);
    return row;
  }
  async function item(ctx: ToolContext, code: string): Promise<{ id: string; code: string; name: string }> {
    const r = await prisma.item.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code }, { id: code }] }, select: { id: true, code: true, name: true, nameAr: true } });
    if (!r) throw actionError("ITEM_NOT_FOUND", `Item ${code} not found`);
    return { id: r.id, code: r.code, name: name(ctx, r) };
  }
  async function account(ctx: ToolContext, code: string): Promise<{ id: string; code: string; name: string }> {
    const r = await prisma.account.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code }, { id: code }] }, select: { id: true, code: true, name: true, nameAr: true } });
    if (!r) throw actionError("ACCOUNT_NOT_FOUND", `Account ${code} not found`);
    return { id: r.id, code: r.code, name: name(ctx, r) };
  }
  async function warehouse(ctx: ToolContext, code: string | undefined): Promise<{ id: string; code: string; name: string }> {
    const rows = await prisma.warehouse.findMany({ where: { companyId: ctx.actor.companyId, isActive: true, ...(code ? { OR: [{ code }, { id: code }] } : {}) }, select: { id: true, code: true, name: true, nameAr: true }, take: 2 });
    if (rows.length === 0) throw actionError("WAREHOUSE_NOT_FOUND", code ? `Warehouse ${code} not found` : "No active warehouse");
    // Without a code, only an unambiguous single warehouse is a safe default.
    if (!code && rows.length > 1) throw actionError("WAREHOUSE_REQUIRED", "Several warehouses: ask the user which one (inventory_warehouses)");
    const r = rows[0]!;
    return { id: r.id, code: r.code, name: name(ctx, r) };
  }
  async function taxCode(ctx: ToolContext, code: string | undefined): Promise<{ id: string; code: string }> {
    const codes = await prisma.taxCode.findMany({ where: { companyId: ctx.actor.companyId, isActive: true }, select: { id: true, code: true, treatment: true } });
    const given = code ? codes.find((t) => t.code === code || t.id === code) : undefined;
    if (code && !given) throw actionError("TAX_CODE_NOT_FOUND", `Tax code ${code} not found`);
    const standard = codes.filter((t) => t.treatment === "STANDARD");
    const t = given ?? (standard.length === 1 ? standard[0] : undefined);
    if (!t) throw actionError("TAX_CODE_REQUIRED", "Several or no standard tax codes: ask the user which tax code applies (taxCodes_list)");
    return { id: t.id, code: t.code };
  }
  async function party(ctx: ToolContext, ref: string): Promise<{ id: string; name: string; kind: string }> {
    const r = await prisma.party.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ id: ref }, { ref }] }, select: { id: true, name: true, nameAr: true, kind: true } });
    if (!r) throw actionError("PARTY_NOT_FOUND", `Party ${ref} not found`);
    return { id: r.id, name: name(ctx, r), kind: r.kind };
  }
  async function employee(ctx: ToolContext, ref: string): Promise<{ id: string; name: string }> {
    const r = await prisma.employee.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ id: ref }, { ref }] }, select: { id: true, name: true, nameAr: true } });
    if (!r) throw actionError("EMPLOYEE_NOT_FOUND", `Employee ${ref} not found`);
    return { id: r.id, name: name(ctx, r) };
  }
  // Shows a lookup on the card without failing the preview: the error appears as a warning instead.
  async function show<T>(work: Promise<T>, warnings: string[], warningKey: string): Promise<T | null> {
    try {
      return await work;
    } catch {
      warnings.push(warningKey);
      return null;
    }
  }
  const card = (titleKey: string, entity: string, fields: Field[], warnings: string[]): ChangePreview => ({
    titleKey,
    entity,
    fields,
    ...(warnings.length ? { warningKeys: [...new Set(warnings)] } : {}),
  });

  // A tool that calls one controller action. `body` builds the DTO body from the model's input.
  function action<S extends z.ZodType>(spec: {
    name: string;
    description: string;
    input: S;
    permission: { resource: string; action: string };
    risk: ToolRisk;
    preview: (ctx: ToolContext, a: z.infer<S>) => Promise<ChangePreview>;
    execute: (ctx: ToolContext, a: z.infer<S>, key: string) => Promise<{ data: Record<string, unknown>; link?: { label: string; path: string } }>;
  }): ErpTool {
    return defineWriteTool({
      name: spec.name,
      description: spec.description,
      input: spec.input,
      permission: spec.permission,
      risk: spec.risk,
      preview: spec.preview,
      execute: (ctx, a) => run(() => spec.execute(ctx, a, keyOf(ctx, spec.name, a))),
    });
  }

  const docRef = z.string().trim().min(1).max(60);
  const docRefOf = (what: string): z.ZodString => docRef.describe(`${what} id or number (e.g. from a search tool)`);

  // ─── 1. Sales lifecycle ────────────────────────────────────────────────────────────────────────
  const quotationStatusCard = async (ctx: ToolContext, ref: string, titleKey: string): Promise<ChangePreview> => {
    const warnings: string[] = [];
    const q = await show(doc(ctx, "quotation", ref), warnings, "ai.warn.documentNotFound");
    const row = q ? await prisma.quotation.findUnique({ where: { id: q.id }, select: { totalGross: true, customer: { select: { name: true, nameAr: true } } } }) : null;
    if (q && q.status !== "OPEN") warnings.push("ai.warn.notOpen");
    return card(titleKey, "quotation", [
      { labelKey: "ai.col.document", value: q?.number ?? ref },
      ...field("ai.col.customer", row ? name(ctx, row.customer) : null),
      ...field("ai.col.total", row?.totalGross.toFixed(2)),
      ...field("ai.col.status", q?.status),
    ], warnings);
  };

  const cancelQuotation = action({
    name: "sales_cancelQuotation",
    description: "Cancel an OPEN quotation (the customer no longer wants it, or it is replaced). Nothing is posted. To change a quotation's price or lines, cancel it and create a new one with sales_createQuotation.",
    input: z.object({ quotation: docRefOf("Quotation") }),
    permission: { resource: "quotation", action: "update" },
    risk: "low",
    preview: (ctx, a) => quotationStatusCard(ctx, a.quotation, "ai.preview.cancelQuotation"),
    execute: async (ctx, a) => {
      const q = await doc(ctx, "quotation", a.quotation);
      await controller(SalesController).cancelQuotation(q.id, actorOf(ctx), ctx.correlationId);
      return { data: { id: q.id, number: q.number, status: "CANCELLED" }, link: { label: q.number, path: `/sales/quotations/${q.id}` } };
    },
  });

  const rejectQuotation = action({
    name: "sales_rejectQuotation",
    description: "Mark an OPEN quotation as rejected by the customer. Nothing is posted.",
    input: z.object({ quotation: docRefOf("Quotation") }),
    permission: { resource: "quotation", action: "update" },
    risk: "low",
    preview: (ctx, a) => quotationStatusCard(ctx, a.quotation, "ai.preview.rejectQuotation"),
    execute: async (ctx, a) => {
      const q = await doc(ctx, "quotation", a.quotation);
      await controller(SalesController).rejectQuotation(q.id, actorOf(ctx), ctx.correlationId);
      return { data: { id: q.id, number: q.number, status: "REJECTED" }, link: { label: q.number, path: `/sales/quotations/${q.id}` } };
    },
  });

  const convertQuotation = action({
    name: "sales_convertQuotation",
    description: "Turn an accepted OPEN quotation into a sales order with the same customer and lines.",
    input: z.object({ quotation: docRefOf("Quotation"), orderDate: date.optional().describe("Defaults to today") }),
    permission: { resource: "sales_order", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const c = await quotationStatusCard(ctx, a.quotation, "ai.preview.convertQuotation");
      return { ...c, fields: [...c.fields, { labelKey: "ai.col.date", value: a.orderDate ?? today() }] };
    },
    execute: async (ctx, a) => {
      const q = await doc(ctx, "quotation", a.quotation);
      const dto = await toDto(ConvertQuotationDto, { orderDate: a.orderDate ?? today() });
      const order = await controller(SalesController).convertQuotation(q.id, dto, actorOf(ctx), ctx.correlationId);
      const o = order as unknown as { id: string; number: string };
      return { data: { id: o.id, number: o.number, fromQuotation: q.number }, link: { label: o.number, path: `/sales/orders/${o.id}` } };
    },
  });

  // Lines the model gives for sales documents: item code or free text, quantity, unit price, tax code.
  const salesLine = z.object({
    itemCode: z.string().trim().max(40).optional().describe("Item code from items_search; omit for a service or free-text line"),
    description: z.string().trim().max(300).optional().describe("Required when there is no itemCode"),
    quantity: decimal,
    unitPrice: decimal.describe("Price of ONE unit, excluding VAT"),
    taxCode: z.string().trim().max(20).optional().describe("Tax code from taxCodes_list; omit for the company's only standard-rated code"),
  });
  type SalesLineArgs = z.infer<typeof salesLine>;
  async function salesLines(ctx: ToolContext, lines: readonly SalesLineArgs[]): Promise<Array<{ itemId?: string; description?: string; quantity: string; unitPrice: string; taxCodeId: string }>> {
    const out = [];
    for (const l of lines) {
      const it = l.itemCode ? await item(ctx, l.itemCode) : undefined;
      if (!it && !l.description) throw actionError("DESCRIPTION_REQUIRED", "A line without an item needs a description");
      const tax = await taxCode(ctx, l.taxCode);
      out.push({ ...(it ? { itemId: it.id } : {}), ...(l.description ? { description: l.description } : {}), quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: tax.id });
    }
    return out;
  }
  // Card lines and totals from the same core line math the services use.
  async function salesTotals(ctx: ToolContext, lines: readonly SalesLineArgs[], warnings: string[]): Promise<Field[]> {
    try {
      const resolved = await resolveSalesLines(prisma, ctx.actor.companyId, await salesLines(ctx, lines));
      const t = totalsOf(resolved);
      return [
        ...resolved.map((l) => ({ labelKey: "ai.col.line", value: `${l.description} — ${l.quantity.toString()} × ${l.unitPrice.toFixed(2)} (${l.taxRate.toFixed(0)}%) = ${l.net.add(l.tax).toFixed(2)}` })),
        { labelKey: "ai.col.net", value: t.net.toFixed(2) },
        { labelKey: "ai.col.tax", value: t.tax.toFixed(2) },
        { labelKey: "ai.col.total", value: t.gross.toFixed(2) },
      ];
    } catch {
      warnings.push("ai.warn.linesInvalid");
      return [];
    }
  }

  const createSalesOrder = action({
    name: "sales_createOrder",
    description: "Create a sales order for a customer (no ledger entry; it reserves nothing). Use parties_search and items_search first, clarify when several match. unitPrice EXCLUDES VAT; never compute totals yourself.",
    input: z.object({
      customerId: z.string().trim().min(1).describe("Customer id from parties_search"),
      orderDate: date.optional(),
      notes: z.string().trim().max(1000).optional(),
      lines: z.array(salesLine).min(1).max(50),
    }),
    permission: { resource: "sales_order", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const c = await show(party(ctx, a.customerId), warnings, "ai.warn.customerNotFound");
      return card("ai.preview.createSalesOrder", "sales_order", [
        { labelKey: "ai.col.customer", value: c?.name ?? a.customerId },
        { labelKey: "ai.col.date", value: a.orderDate ?? today() },
        ...(await salesTotals(ctx, a.lines, warnings)),
        ...field("ai.col.notes", a.notes),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const dto = await toDto(CreateSalesOrderDto, { customerId: (await party(ctx, a.customerId)).id, orderDate: a.orderDate ?? today(), ...(a.notes ? { notes: a.notes } : {}), lines: await salesLines(ctx, a.lines) });
      const r = (await controller(SalesController).createOrder(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/sales/orders/${r.id}` } };
    },
  });

  const cancelSalesOrder = action({
    name: "sales_cancelOrder",
    description: "Cancel a sales order that has not been invoiced or delivered.",
    input: z.object({ order: docRefOf("Sales order") }),
    permission: { resource: "sales_order", action: "cancel" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const o = await show(doc(ctx, "salesOrder", a.order), warnings, "ai.warn.documentNotFound");
      if (o && o.status !== "OPEN") warnings.push("ai.warn.notOpen");
      return card("ai.preview.cancelSalesOrder", "sales_order", [{ labelKey: "ai.col.document", value: o?.number ?? a.order }, ...field("ai.col.status", o?.status)], warnings);
    },
    execute: async (ctx, a) => {
      const o = await doc(ctx, "salesOrder", a.order);
      await controller(SalesController).cancelOrder(o.id, actorOf(ctx), ctx.correlationId);
      return { data: { id: o.id, number: o.number, status: "CANCELLED" }, link: { label: o.number, path: `/sales/orders/${o.id}` } };
    },
  });

  // Delivery: by default everything still undelivered on the order; or named items with quantities.
  const deliveryInput = z.object({
    order: docRefOf("Sales order"),
    deliveryDate: date.optional(),
    driverName: z.string().trim().max(200).optional(),
    receiverName: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(z.object({ itemCode: z.string().trim().max(40).describe("Item code on the order"), quantity: decimal })).max(50).optional().describe("Omit to deliver everything still undelivered"),
  });
  async function deliveryLines(ctx: ToolContext, a: z.infer<typeof deliveryInput>): Promise<{ orderId: string; number: string; lines: Array<{ salesOrderLineId: string; quantity: string; label: string }> }> {
    const o = await doc(ctx, "salesOrder", a.order);
    const rows = await prisma.salesOrderLine.findMany({ where: { salesOrderId: o.id }, orderBy: { lineNumber: "asc" }, select: { id: true, description: true, quantity: true, deliveredQuantity: true, item: { select: { code: true } } } });
    const open = rows.map((r) => ({ ...r, left: r.quantity.sub(r.deliveredQuantity) })).filter((r) => r.left.gt(0));
    const lines = a.lines?.length
      ? a.lines.map((l) => {
          const r = open.find((x) => x.item?.code === l.itemCode);
          if (!r) throw actionError("LINE_NOT_ON_ORDER", `${l.itemCode} has nothing left to deliver on ${o.number}`);
          return { salesOrderLineId: r.id, quantity: l.quantity, label: `${r.description} — ${l.quantity}` };
        })
      : open.map((r) => ({ salesOrderLineId: r.id, quantity: r.left.toString(), label: `${r.description} — ${r.left.toString()}` }));
    if (lines.length === 0) throw actionError("NOTHING_TO_DELIVER", `${o.number} is fully delivered`);
    return { orderId: o.id, number: o.number, lines };
  }

  const createDeliveryNote = action({
    name: "sales_createDeliveryNote",
    description: "Record a goods delivery note against a sales order (stock leaves the warehouse). Omit lines to deliver everything still undelivered.",
    input: deliveryInput,
    permission: { resource: "sales_delivery_note", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const d = await show(deliveryLines(ctx, a), warnings, "ai.warn.linesInvalid");
      return card("ai.preview.createDeliveryNote", "delivery_note", [
        { labelKey: "ai.col.document", value: d?.number ?? a.order },
        { labelKey: "ai.col.date", value: a.deliveryDate ?? today() },
        ...(d?.lines.map((l) => ({ labelKey: "ai.col.line", value: l.label })) ?? []),
        ...field("ai.col.driver", a.driverName),
        ...field("ai.col.receiver", a.receiverName),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const d = await deliveryLines(ctx, a);
      const dto = await toDto(CreateGoodsDeliveryNoteDto, {
        salesOrderId: d.orderId,
        deliveryDate: a.deliveryDate ?? today(),
        ...(a.driverName ? { driverName: a.driverName } : {}),
        ...(a.receiverName ? { receiverName: a.receiverName } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        lines: d.lines.map(({ salesOrderLineId, quantity }) => ({ salesOrderLineId, quantity })),
      });
      const r = (await controller(SalesController).createDeliveryNote(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number, order: d.number }, link: { label: r.number, path: `/sales/delivery-notes/${r.id}` } };
    },
  });

  const createSalesInvoice = action({
    name: "sales_createInvoice",
    description:
      "Post a tax sales invoice to a customer. This posts to the ledger, moves stock for items, and is reported to ZATCA like an invoice entered on the page. " +
      "Use parties_search / items_search first and clarify when several match. unitPrice EXCLUDES VAT. If an item is in several warehouses, ask which one. Never compute totals yourself.",
    input: z.object({
      customerId: z.string().trim().min(1).describe("Customer id from parties_search"),
      invoiceDate: date.optional(),
      dueDate: date.optional(),
      notes: z.string().trim().max(1000).optional(),
      warehouseCode: z.string().trim().max(40).optional().describe("Warehouse the items leave from; omit when the company has one warehouse"),
      lines: z.array(salesLine).min(1).max(50),
    }),
    permission: { resource: "sales_invoice", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const c = await show(party(ctx, a.customerId), warnings, "ai.warn.customerNotFound");
      const hasItems = a.lines.some((l) => l.itemCode);
      const w = hasItems ? await show(warehouse(ctx, a.warehouseCode), warnings, "ai.warn.warehouseRequired") : null;
      return card("ai.preview.createSalesInvoice", "sales_invoice", [
        { labelKey: "ai.col.customer", value: c?.name ?? a.customerId },
        { labelKey: "ai.col.date", value: a.invoiceDate ?? today() },
        ...field("ai.col.dueDate", a.dueDate),
        ...field("ai.col.warehouse", w?.name),
        ...(await salesTotals(ctx, a.lines, warnings)),
        ...field("ai.col.notes", a.notes),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const lines = await salesLines(ctx, a.lines);
      const w = lines.some((l) => l.itemId) ? await warehouse(ctx, a.warehouseCode) : null;
      const dto = await toDto(CreateSalesInvoiceDto, {
        customerId: (await party(ctx, a.customerId)).id,
        invoiceDate: a.invoiceDate ?? today(),
        ...(a.dueDate ? { dueDate: a.dueDate } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        lines: lines.map((l) => ({ ...l, ...(l.itemId && w ? { warehouseId: w.id } : {}) })),
      });
      const r = (await controller(SalesController).createInvoice(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/sales/invoices/${r.id}` } };
    },
  });

  // Credit / debit note lines: an item (or description) from the original invoice and a quantity;
  // price and tax default to the original line's.
  const noteLine = z.object({
    itemCode: z.string().trim().max(40).optional().describe("Item code of a line on the original invoice"),
    description: z.string().trim().max(300).optional().describe("Line description when there is no item"),
    quantity: decimal,
    unitPrice: decimal.optional().describe("Defaults to the original line's price (excluding VAT)"),
  });
  type NoteLine = z.infer<typeof noteLine>;
  async function salesNoteLines(ctx: ToolContext, invoiceId: string, lines: readonly NoteLine[]): Promise<Array<{ originalLineId: string; description: string; quantity: string; unitPrice: string; taxCodeId: string; warehouseId?: string; net: Prisma.Decimal }>> {
    const original = await prisma.salesInvoiceLine.findMany({ where: { salesInvoiceId: invoiceId }, orderBy: { lineNumber: "asc" }, select: { id: true, description: true, unitPrice: true, taxCodeId: true, warehouseId: true, item: { select: { code: true } } } });
    return lines.map((l) => {
      const o = original.find((x) => (l.itemCode ? x.item?.code === l.itemCode : x.description === l.description)) ?? (original.length === 1 && !l.itemCode ? original[0] : undefined);
      if (!o) throw actionError("LINE_NOT_ON_INVOICE", `${l.itemCode ?? l.description ?? "line"} is not on the original invoice`);
      const unitPrice = l.unitPrice ?? o.unitPrice.toFixed(2);
      return { originalLineId: o.id, description: o.description, quantity: l.quantity, unitPrice, taxCodeId: o.taxCodeId, ...(o.warehouseId ? { warehouseId: o.warehouseId } : {}), net: D(l.quantity).mul(unitPrice) };
    });
  }
  const noteInput = z.object({
    invoice: docRefOf("Original sales invoice"),
    date: date.optional(),
    notes: z.string().trim().max(1000).optional().describe("Reason shown on the note"),
    lines: z.array(noteLine).min(1).max(50),
  });
  async function salesNoteCard(ctx: ToolContext, a: z.infer<typeof noteInput>, titleKey: string): Promise<ChangePreview> {
    const warnings: string[] = [];
    const inv = await show(doc(ctx, "salesInvoice", a.invoice), warnings, "ai.warn.documentNotFound");
    const lines = inv ? await show(salesNoteLines(ctx, inv.id, a.lines), warnings, "ai.warn.linesInvalid") : null;
    const net = lines?.reduce((sum, l) => sum.add(l.net), D("0"));
    return card(titleKey, "sales_invoice", [
      { labelKey: "ai.col.document", value: inv?.number ?? a.invoice },
      { labelKey: "ai.col.date", value: a.date ?? today() },
      ...(lines?.map((l) => ({ labelKey: "ai.col.line", value: `${l.description} — ${l.quantity} × ${l.unitPrice}` })) ?? []),
      ...field("ai.col.netBeforeTax", net?.toFixed(2)),
      ...field("ai.col.notes", a.notes),
    ], warnings);
  }
  const noteBody = (l: Awaited<ReturnType<typeof salesNoteLines>>[number]): Omit<typeof l, "net"> => without(l, "net");

  const createCreditNote = action({
    name: "sales_createCreditNote",
    description: "Post a credit note against a posted sales invoice (returned goods, a discount, or a cancelled invoice). This is how a posted invoice is corrected or cancelled. It posts to the ledger and is reported to ZATCA.",
    input: noteInput,
    permission: { resource: "credit_note", action: "create" },
    risk: "high",
    preview: (ctx, a) => salesNoteCard(ctx, a, "ai.preview.createCreditNote"),
    execute: async (ctx, a, key) => {
      const inv = await doc(ctx, "salesInvoice", a.invoice);
      const dto = await toDto(CreateCreditNoteDto, { creditDate: a.date ?? today(), ...(a.notes ? { notes: a.notes } : {}), lines: (await salesNoteLines(ctx, inv.id, a.lines)).map(noteBody) });
      const r = (await controller(SalesController).createCreditNote(inv.id, dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number, invoice: inv.number }, link: { label: r.number, path: `/sales/invoices/${r.id}` } };
    },
  });

  const createDebitNote = action({
    name: "sales_createDebitNote",
    description: "Post a debit note against a posted sales invoice (an extra charge on the same sale). It posts to the ledger and is reported to ZATCA.",
    input: noteInput,
    permission: { resource: "debit_note", action: "create" },
    risk: "high",
    preview: (ctx, a) => salesNoteCard(ctx, a, "ai.preview.createDebitNote"),
    execute: async (ctx, a, key) => {
      const inv = await doc(ctx, "salesInvoice", a.invoice);
      // A sales debit note is a new charge: its lines carry no link to the original line or warehouse.
      const lines = (await salesNoteLines(ctx, inv.id, a.lines)).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: l.taxCodeId }));
      const dto = await toDto(CreateDebitNoteDto, { debitDate: a.date ?? today(), ...(a.notes ? { notes: a.notes } : {}), lines });
      const r = (await controller(SalesController).createDebitNote(inv.id, dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number, invoice: inv.number }, link: { label: r.number, path: `/sales/invoices/${r.id}` } };
    },
  });

  // ─── 2. Payments ───────────────────────────────────────────────────────────────────────────────
  const paymentInput = z.object({
    partyId: z.string().trim().min(1).describe("Customer (receipt) or supplier (payment) id from parties_search"),
    amount: decimal.describe("Amount received or paid"),
    paymentDate: date.optional(),
    cashAccountCode: z.string().trim().max(40).describe("Code of the account the money goes into or out of (accounts_search): a cash account for CASH, a bank account for other methods; ask if unsure"),
    method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
    reference: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    allocations: z.array(z.object({ invoice: docRefOf("Invoice"), amount: decimal })).max(50).optional().describe("Invoices this settles; omit to leave the amount on account"),
  });
  type PaymentArgs = z.infer<typeof paymentInput>;
  async function paymentBody(ctx: ToolContext, a: PaymentArgs, kind: "CUSTOMER" | "SUPPLIER"): Promise<Record<string, unknown>> {
    const p = await party(ctx, a.partyId);
    const cash = await account(ctx, a.cashAccountCode);
    const allocations = [];
    for (const al of a.allocations ?? []) {
      const inv = await doc(ctx, kind === "CUSTOMER" ? "salesInvoice" : "supplierInvoice", al.invoice);
      allocations.push({ invoiceId: inv.id, amount: al.amount });
    }
    return { partyId: p.id, counterpartyKind: kind, paymentDate: a.paymentDate ?? today(), amount: a.amount, cashAccountId: cash.id, method: a.method, ...(a.reference ? { reference: a.reference } : {}), ...(a.notes ? { notes: a.notes } : {}), allocations };
  }
  async function paymentCard(ctx: ToolContext, a: PaymentArgs, titleKey: string): Promise<ChangePreview> {
    const warnings: string[] = [];
    const p = await show(party(ctx, a.partyId), warnings, "ai.warn.partyNotFound");
    const cash = await show(account(ctx, a.cashAccountCode), warnings, "ai.warn.accountNotFound");
    return card(titleKey, "payment", [
      { labelKey: "ai.col.party", value: p?.name ?? a.partyId },
      { labelKey: "ai.col.amount", value: D(a.amount).toFixed(2) },
      { labelKey: "ai.col.date", value: a.paymentDate ?? today() },
      { labelKey: "ai.col.cashAccount", value: cash ? `${cash.code} ${cash.name}` : a.cashAccountCode },
      { labelKey: "ai.col.method", value: a.method },
      ...(a.allocations ?? []).map((al) => ({ labelKey: "ai.col.allocation", value: `${al.invoice} — ${D(al.amount).toFixed(2)}` })),
      ...field("ai.col.reference", a.reference),
    ], warnings);
  }

  const customerReceipt = action({
    name: "payments_customerReceipt",
    description: "Post a receipt (money received from a customer), optionally settling named invoices. Posts to the ledger.",
    input: paymentInput,
    permission: { resource: "customer_receipt", action: "create" },
    risk: "high",
    preview: (ctx, a) => paymentCard(ctx, a, "ai.preview.customerReceipt"),
    execute: async (ctx, a, key) => {
      const dto = await toDto(CreatePaymentDto, await paymentBody(ctx, a, "CUSTOMER"));
      const r = (await controller(PaymentsController).createReceipt(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/payments/${r.id}` } };
    },
  });

  const supplierPayment = action({
    name: "payments_supplierPayment",
    description: "Post a payment to a supplier, optionally settling named supplier invoices. Posts to the ledger.",
    input: paymentInput,
    permission: { resource: "supplier_payment", action: "create" },
    risk: "high",
    preview: (ctx, a) => paymentCard(ctx, a, "ai.preview.supplierPayment"),
    execute: async (ctx, a, key) => {
      const dto = await toDto(CreatePaymentDto, await paymentBody(ctx, a, "SUPPLIER"));
      const r = (await controller(PaymentsController).createPayment(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/payments/${r.id}` } };
    },
  });

  const reversePayment = action({
    name: "payments_reverse",
    description: "Reverse a posted receipt or payment (a reversing entry; the original stays in the books).",
    input: z.object({ payment: docRefOf("Payment") }),
    permission: { resource: "payment", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const p = await show(doc(ctx, "payment", a.payment), warnings, "ai.warn.documentNotFound");
      const row = p ? await prisma.payment.findUnique({ where: { id: p.id }, select: { amount: true, paymentDate: true } }) : null;
      return card("ai.preview.reversePayment", "payment", [
        { labelKey: "ai.col.document", value: p?.number ?? a.payment },
        ...field("ai.col.amount", row?.amount.toFixed(2)),
        ...field("ai.col.date", row?.paymentDate.toISOString().slice(0, 10)),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const p = await doc(ctx, "payment", a.payment);
      const r = (await controller(PaymentsController).reversePayment(p.id, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { reversed: p.number, ...(r.number ? { number: r.number } : {}) }, link: { label: p.number, path: `/payments/${p.id}` } };
    },
  });

  // ─── 3. Purchasing ─────────────────────────────────────────────────────────────────────────────
  const qtyLine = z.object({ itemCode: z.string().trim().max(40), quantity: decimal });

  const createPurchaseRequest = action({
    name: "purchasing_createRequest",
    description: "Raise a purchase request for items into a warehouse (no ledger entry). Purchasing turns it into an order.",
    input: z.object({ warehouseCode: z.string().trim().max(40).optional(), notes: z.string().trim().max(1000).optional(), lines: z.array(qtyLine.extend({ notes: z.string().trim().max(300).optional() })).min(1).max(50) }),
    permission: { resource: "purchase_request", action: "create" },
    risk: "low",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const w = await show(warehouse(ctx, a.warehouseCode), warnings, "ai.warn.warehouseRequired");
      const lines: Field[] = [];
      for (const l of a.lines) {
        const it = await show(item(ctx, l.itemCode), warnings, "ai.warn.linesInvalid");
        lines.push({ labelKey: "ai.col.line", value: `${it?.name ?? l.itemCode} — ${l.quantity}` });
      }
      return card("ai.preview.createPurchaseRequest", "purchase_request", [...field("ai.col.warehouse", w?.name), ...lines, ...field("ai.col.notes", a.notes)], warnings);
    },
    execute: async (ctx, a, key) => {
      const w = await warehouse(ctx, a.warehouseCode);
      const lines = [];
      for (const l of a.lines) lines.push({ itemId: (await item(ctx, l.itemCode)).id, quantity: l.quantity, ...(l.notes ? { notes: l.notes } : {}) });
      const dto = await toDto(CreatePurchaseRequestDto, { warehouseId: w.id, ...(a.notes ? { notes: a.notes } : {}), lines });
      const r = (await controller(PurchasingController).createRequest(key, dto, actorOf(ctx), ctx.correlationId)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/purchasing/requests/${r.id}` } };
    },
  });

  const poInput = z.object({
    supplierId: z.string().trim().min(1).describe("Supplier id from parties_search"),
    warehouseCode: z.string().trim().max(40).optional(),
    orderDate: date.optional(),
    expectedDate: date.optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(qtyLine.extend({ unitPrice: decimal.describe("Price of ONE unit, excluding VAT"), taxCode: z.string().trim().max(20).optional() })).min(1).max(50),
  });
  const createPurchaseOrder = action({
    name: "purchasing_createOrder",
    description: "Create a purchase order to a supplier. It goes through the company's approval rules before goods can be received. unitPrice EXCLUDES VAT.",
    input: poInput,
    permission: { resource: "purchase_order", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const sup = await show(party(ctx, a.supplierId), warnings, "ai.warn.partyNotFound");
      const w = await show(warehouse(ctx, a.warehouseCode), warnings, "ai.warn.warehouseRequired");
      let net = D("0");
      const lines: Field[] = [];
      for (const l of a.lines) {
        const it = await show(item(ctx, l.itemCode), warnings, "ai.warn.linesInvalid");
        const lineNet = D(l.quantity).mul(l.unitPrice);
        net = net.add(lineNet);
        lines.push({ labelKey: "ai.col.line", value: `${it?.name ?? l.itemCode} — ${l.quantity} × ${D(l.unitPrice).toFixed(2)} = ${lineNet.toFixed(2)}` });
      }
      return card("ai.preview.createPurchaseOrder", "purchase_order", [
        { labelKey: "ai.col.supplier", value: sup?.name ?? a.supplierId },
        ...field("ai.col.warehouse", w?.name),
        { labelKey: "ai.col.date", value: a.orderDate ?? today() },
        ...lines,
        { labelKey: "ai.col.netBeforeTax", value: net.toFixed(2) },
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const w = await warehouse(ctx, a.warehouseCode);
      const lines = [];
      for (const l of a.lines) lines.push({ itemId: (await item(ctx, l.itemCode)).id, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: (await taxCode(ctx, l.taxCode)).id });
      const dto = await toDto(CreatePurchaseOrderDto, { supplierId: (await party(ctx, a.supplierId)).id, warehouseId: w.id, orderDate: a.orderDate ?? today(), ...(a.expectedDate ? { expectedDate: a.expectedDate } : {}), ...(a.notes ? { notes: a.notes } : {}), lines });
      const r = (await controller(PurchasingController).createOrder(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/purchasing/orders/${r.id}` } };
    },
  });

  const poStatusCard = async (ctx: ToolContext, ref: string, titleKey: string, expect: string[]): Promise<ChangePreview> => {
    const warnings: string[] = [];
    const o = await show(doc(ctx, "purchaseOrder", ref), warnings, "ai.warn.documentNotFound");
    const row = o ? await prisma.purchaseOrder.findUnique({ where: { id: o.id }, select: { supplier: { select: { name: true, nameAr: true } } } }) : null;
    if (o && o.status && !expect.includes(o.status)) warnings.push("ai.warn.notOpen");
    return card(titleKey, "purchase_order", [{ labelKey: "ai.col.document", value: o?.number ?? ref }, ...field("ai.col.supplier", row ? name(ctx, row.supplier) : null), ...field("ai.col.status", o?.status)], warnings);
  };

  const approvePurchaseOrder = action({
    name: "purchasing_approveOrder",
    description: "Approve a purchase order that is pending approval. The company's approval rules still apply (who may approve, amount limits).",
    input: z.object({ order: docRefOf("Purchase order"), reason: z.string().trim().max(500).optional() }),
    permission: { resource: "purchase_order", action: "approve" },
    risk: "high",
    preview: (ctx, a) => poStatusCard(ctx, a.order, "ai.preview.approvePurchaseOrder", ["PENDING_APPROVAL"]),
    execute: async (ctx, a) => {
      const o = await doc(ctx, "purchaseOrder", a.order);
      const dto = await toDto(DecidePurchaseOrderDto, a.reason ? { reason: a.reason } : {});
      await controller(PurchasingController).approveOrder(o.id, dto, actorOf(ctx), ctx.correlationId);
      return { data: { id: o.id, number: o.number }, link: { label: o.number, path: `/purchasing/orders/${o.id}` } };
    },
  });

  const cancelPurchaseOrder = action({
    name: "purchasing_cancelOrder",
    description: "Cancel a purchase order that has not been received.",
    input: z.object({ order: docRefOf("Purchase order") }),
    permission: { resource: "purchase_order", action: "cancel" },
    risk: "high",
    preview: (ctx, a) => poStatusCard(ctx, a.order, "ai.preview.cancelPurchaseOrder", ["PENDING_APPROVAL", "APPROVED"]),
    execute: async (ctx, a) => {
      const o = await doc(ctx, "purchaseOrder", a.order);
      await controller(PurchasingController).cancelOrder(o.id, actorOf(ctx), ctx.correlationId);
      return { data: { id: o.id, number: o.number, status: "CANCELLED" }, link: { label: o.number, path: `/purchasing/orders/${o.id}` } };
    },
  });

  const receiveInput = z.object({
    order: docRefOf("Purchase order"),
    warehouseCode: z.string().trim().max(40).optional(),
    documentDate: date.optional(),
    reference: z.string().trim().max(200).optional().describe("Supplier's delivery note number"),
    lines: z.array(qtyLine).max(50).optional().describe("Omit to receive everything still outstanding"),
  });
  async function receiveLines(ctx: ToolContext, a: z.infer<typeof receiveInput>): Promise<{ orderId: string; number: string; lines: Array<{ purchaseOrderLineId: string; quantity: string; label: string }> }> {
    const o = await doc(ctx, "purchaseOrder", a.order);
    const rows = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: o.id }, orderBy: { lineNumber: "asc" }, select: { id: true, quantity: true, receivedQuantity: true, item: { select: { code: true, name: true, nameAr: true } } } });
    const open = rows.map((r) => ({ ...r, left: r.quantity.sub(r.receivedQuantity) })).filter((r) => r.left.gt(0));
    const lines = a.lines?.length
      ? a.lines.map((l) => {
          const r = open.find((x) => x.item.code === l.itemCode);
          if (!r) throw actionError("LINE_NOT_ON_ORDER", `${l.itemCode} has nothing left to receive on ${o.number}`);
          return { purchaseOrderLineId: r.id, quantity: l.quantity, label: `${name(ctx, r.item)} — ${l.quantity}` };
        })
      : open.map((r) => ({ purchaseOrderLineId: r.id, quantity: r.left.toString(), label: `${name(ctx, r.item)} — ${r.left.toString()}` }));
    if (lines.length === 0) throw actionError("NOTHING_TO_RECEIVE", `${o.number} is fully received`);
    return { orderId: o.id, number: o.number, lines };
  }
  const receivePurchaseOrder = action({
    name: "purchasing_receiveOrder",
    description: "Record goods received against an approved purchase order (stock comes in). Omit lines to receive everything outstanding.",
    input: receiveInput,
    permission: { resource: "goods_receipt", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const r = await show(receiveLines(ctx, a), warnings, "ai.warn.linesInvalid");
      const w = await show(warehouse(ctx, a.warehouseCode), warnings, "ai.warn.warehouseRequired");
      return card("ai.preview.receivePurchaseOrder", "goods_receipt", [
        { labelKey: "ai.col.document", value: r?.number ?? a.order },
        ...field("ai.col.warehouse", w?.name),
        { labelKey: "ai.col.date", value: a.documentDate ?? today() },
        ...(r?.lines.map((l) => ({ labelKey: "ai.col.line", value: l.label })) ?? []),
        ...field("ai.col.reference", a.reference),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const r = await receiveLines(ctx, a);
      const w = await warehouse(ctx, a.warehouseCode);
      const dto = await toDto(ReceivePurchaseOrderDto, { warehouseId: w.id, documentDate: a.documentDate ?? today(), ...(a.reference ? { reference: a.reference } : {}), lines: r.lines.map(({ purchaseOrderLineId, quantity }) => ({ purchaseOrderLineId, quantity })) });
      const res = (await controller(PurchasingController).receive(r.orderId, dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { order: r.number, ...(res.number ? { number: res.number } : {}) }, link: { label: r.number, path: `/purchasing/orders/${r.orderId}` } };
    },
  });

  const supplierDebitNote = action({
    name: "purchasing_supplierDebitNote",
    description: "Post a debit note to a supplier against a posted supplier invoice (goods returned or an overcharge). Posts to the ledger.",
    input: noteInput.extend({ invoice: docRefOf("Original supplier invoice") }),
    permission: { resource: "debit_note", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const inv = await show(doc(ctx, "supplierInvoice", a.invoice), warnings, "ai.warn.documentNotFound");
      const lines = inv ? await show(supplierNoteLines(ctx, inv.id, a.lines), warnings, "ai.warn.linesInvalid") : null;
      const net = lines?.reduce((sum, l) => sum.add(D(l.quantity).mul(l.unitPrice)), D("0"));
      return card("ai.preview.supplierDebitNote", "supplier_invoice", [
        { labelKey: "ai.col.document", value: inv?.number ?? a.invoice },
        { labelKey: "ai.col.date", value: a.date ?? today() },
        ...(lines?.map((l) => ({ labelKey: "ai.col.line", value: `${l.description} — ${l.quantity} × ${l.unitPrice}` })) ?? []),
        ...field("ai.col.netBeforeTax", net?.toFixed(2)),
        ...field("ai.col.notes", a.notes),
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const inv = await doc(ctx, "supplierInvoice", a.invoice);
      const dto = await toDto(SupplierDebitNoteDto, { debitDate: a.date ?? today(), ...(a.notes ? { notes: a.notes } : {}), lines: await supplierNoteLines(ctx, inv.id, a.lines) });
      const r = (await controller(InvoicingController).createDebitNote(inv.id, dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number, invoice: inv.number }, link: { label: r.number, path: `/purchasing/invoices/${r.id}` } };
    },
  });
  async function supplierNoteLines(ctx: ToolContext, invoiceId: string, lines: readonly NoteLine[]): Promise<Array<{ originalLineId: string; description: string; quantity: string; unitPrice: string; taxCodeId: string; accountId: string }>> {
    const original = await prisma.supplierInvoiceLine.findMany({
      where: { supplierInvoiceId: invoiceId },
      orderBy: { lineNumber: "asc" },
      select: { id: true, description: true, unitPrice: true, taxCodeId: true, accountId: true, purchaseOrderLine: { select: { item: { select: { code: true, name: true } } } } },
    });
    return lines.map((l) => {
      const o = original.find((x) => (l.itemCode ? x.purchaseOrderLine?.item.code === l.itemCode : x.description === l.description)) ?? (original.length === 1 && !l.itemCode ? original[0] : undefined);
      if (!o) throw actionError("LINE_NOT_ON_INVOICE", `${l.itemCode ?? l.description ?? "line"} is not on the original invoice`);
      if (!o.accountId) throw actionError("ACCOUNT_REQUIRED", "The original line has no account; enter this debit note on the page");
      return { originalLineId: o.id, description: o.description ?? o.purchaseOrderLine?.item.name ?? "-", quantity: l.quantity, unitPrice: l.unitPrice ?? o.unitPrice.toFixed(2), taxCodeId: o.taxCodeId, accountId: o.accountId };
    });
  }

  // ─── 4. Inventory, accounting and parties ──────────────────────────────────────────────────────
  const updateItem = action({
    name: "inventory_updateItem",
    description: "Change an item's name, Arabic name, unit, reorder point, or active flag. Only the fields given change.",
    input: z.object({
      itemCode: z.string().trim().max(40),
      name: z.string().trim().min(1).max(200).optional(),
      nameAr: z.string().trim().max(200).optional(),
      unit: z.string().trim().min(1).max(20).optional(),
      reorderPoint: decimal.optional(),
      isActive: z.boolean().optional(),
    }),
    permission: { resource: "item", action: "update" },
    risk: "low",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const it = await show(prisma.item.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code: a.itemCode }, { id: a.itemCode }] } }), warnings, "ai.warn.documentNotFound");
      if (!it) warnings.push("ai.warn.documentNotFound");
      const changes: Array<{ labelKey: string; value: string; before?: string }> = [];
      const add = (labelKey: string, value: string | undefined, before: string | null | undefined): void => { if (value !== undefined) changes.push({ labelKey, value, ...(before != null ? { before } : {}) }); };
      add("ai.col.name", a.name, it?.name);
      add("ai.col.nameAr", a.nameAr, it?.nameAr);
      add("ai.col.unit", a.unit, it?.unit);
      add("ai.col.reorderPoint", a.reorderPoint, it?.reorderPoint?.toString());
      add("ai.col.active", a.isActive === undefined ? undefined : String(a.isActive), it ? String(it.isActive) : undefined);
      return card("ai.preview.updateItem", "item", [{ labelKey: "ai.col.code", value: it?.code ?? a.itemCode }, ...changes], warnings);
    },
    execute: async (ctx, a) => {
      const it = await item(ctx, a.itemCode);
      const dto = await toDto(UpdateItemDto, without(a, "itemCode"));
      await controller(InventoryController).updateItem(it.id, dto, actorOf(ctx), ctx.correlationId);
      return { data: { id: it.id, code: it.code }, link: { label: it.code, path: `/inventory/items/${it.id}` } };
    },
  });

  const updateWarehouse = action({
    name: "inventory_updateWarehouse",
    description: "Rename a warehouse or set it active/inactive.",
    input: z.object({ warehouseCode: z.string().trim().max(40), name: z.string().trim().min(1).max(200).optional(), nameAr: z.string().trim().max(200).optional(), isActive: z.boolean().optional() }),
    permission: { resource: "warehouse", action: "update" },
    risk: "low",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const w = await prisma.warehouse.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code: a.warehouseCode }, { id: a.warehouseCode }] } });
      if (!w) warnings.push("ai.warn.documentNotFound");
      return card("ai.preview.updateWarehouse", "warehouse", [
        { labelKey: "ai.col.code", value: w?.code ?? a.warehouseCode },
        ...(a.name !== undefined ? [{ labelKey: "ai.col.name", value: a.name, ...(w ? { before: w.name } : {}) }] : []),
        ...(a.nameAr !== undefined ? [{ labelKey: "ai.col.nameAr", value: a.nameAr, ...(w?.nameAr ? { before: w.nameAr } : {}) }] : []),
        ...(a.isActive !== undefined ? [{ labelKey: "ai.col.active", value: String(a.isActive), ...(w ? { before: String(w.isActive) } : {}) }] : []),
      ], warnings);
    },
    execute: async (ctx, a) => {
      const w = await prisma.warehouse.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code: a.warehouseCode }, { id: a.warehouseCode }] }, select: { id: true, code: true } });
      if (!w) throw actionError("WAREHOUSE_NOT_FOUND", `Warehouse ${a.warehouseCode} not found`);
      await controller(InventoryController).updateWarehouse(w.id, await toDto(UpdateWarehouseDto, without(a, "warehouseCode")), actorOf(ctx), ctx.correlationId);
      return { data: { id: w.id, code: w.code }, link: { label: w.code, path: "/inventory/warehouses" } };
    },
  });

  const partyChanges = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    nameAr: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(200).optional(),
    vatNumber: z.string().trim().max(20).optional(),
    commercialRegistration: z.string().trim().max(50).optional(),
    streetName: z.string().trim().max(200).optional(),
    buildingNumber: z.string().trim().max(20).optional(),
    district: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    isActive: z.boolean().optional(),
  });
  const updateParty = action({
    name: "parties_update",
    description: "Change a customer's or supplier's details (name, phone, email, VAT number, CR, address, active flag). Only the fields given change.",
    input: partyChanges.extend({ partyId: z.string().trim().min(1).describe("Party id or ref from parties_search") }),
    permission: { resource: "party", action: "update" },
    risk: "low",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const p = await prisma.party.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ id: a.partyId }, { ref: a.partyId }] } });
      if (!p) warnings.push("ai.warn.partyNotFound");
      const changes = without(a, "partyId");
      const before = p as unknown as Record<string, unknown> | null;
      return card("ai.preview.updateParty", "party", [
        { labelKey: "ai.col.party", value: p ? name(ctx, p) : a.partyId },
        ...Object.entries(changes).map(([k, v]) => {
          const old = before?.[k];
          return { labelKey: `ai.col.${k}`, value: String(v), ...(typeof old === "string" || typeof old === "boolean" ? { before: String(old) } : {}) };
        }),
      ], warnings);
    },
    execute: async (ctx, a) => {
      const p = await party(ctx, a.partyId);
      await controller(PartiesController).update(p.id, await toDto(UpdatePartyDto, without(a, "partyId")), actorOf(ctx), ctx.correlationId);
      return { data: { id: p.id, name: p.name }, link: { label: p.name, path: `/parties/${p.id}` } };
    },
  });

  const stockIssue = action({
    name: "inventory_stockIssue",
    description: "Issue stock out of a warehouse for internal use (charged to a cost center). Posts the cost to the ledger.",
    input: z.object({ warehouseCode: z.string().trim().max(40).optional(), costCenter: z.string().trim().min(1).max(200).describe("Cost center code or name the stock is charged to; ask if unknown"), documentDate: date.optional(), lines: z.array(qtyLine).min(1).max(50) }),
    permission: { resource: "stock_issue", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const w = await show(warehouse(ctx, a.warehouseCode), warnings, "ai.warn.warehouseRequired");
      const lines: Field[] = [];
      for (const l of a.lines) {
        const it = await show(item(ctx, l.itemCode), warnings, "ai.warn.linesInvalid");
        lines.push({ labelKey: "ai.col.line", value: `${it?.name ?? l.itemCode} — ${l.quantity}` });
      }
      return card("ai.preview.stockIssue", "stock_issue", [...field("ai.col.warehouse", w?.name), { labelKey: "ai.col.costCenter", value: a.costCenter }, { labelKey: "ai.col.date", value: a.documentDate ?? today() }, ...lines], warnings);
    },
    execute: async (ctx, a, key) => {
      const w = await warehouse(ctx, a.warehouseCode);
      const lines = [];
      for (const l of a.lines) lines.push({ itemId: (await item(ctx, l.itemCode)).id, quantity: l.quantity });
      const dto = await toDto(CreateStockIssueDto, { warehouseId: w.id, costCenterRef: a.costCenter, documentDate: a.documentDate ?? today(), lines });
      const r = (await controller(InventoryController).createStockIssue(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { ...(r.number ? { number: r.number } : {}), warehouse: w.code }, link: { label: r.number ?? w.code, path: "/inventory/stock-issues" } };
    },
  });

  // Manual journal entry: the most powerful action. Same permission as the page (journal_entry:create),
  // always approved, and the database refuses an unbalanced entry whatever the tool sends.
  const journalEntry = action({
    name: "accounting_journalEntry",
    description:
      "Post a manual journal entry. Only for adjustments with no dedicated document (use invoices, payments and notes for those). " +
      "Each line has an account code and either a debit or a credit; total debits must equal total credits — ask the user for every amount, never compute or balance it yourself. Use accounts_search for codes.",
    input: z.object({
      entryDate: date.optional(),
      description: z.string().trim().min(3).max(300).describe("What the entry is for"),
      lines: z.array(z.object({ accountCode: z.string().trim().max(40), debit: decimal.optional(), credit: decimal.optional(), description: z.string().trim().max(300).optional() })).min(2).max(50),
    }),
    permission: { resource: "journal_entry", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      let dr = D("0");
      let cr = D("0");
      const lines: Field[] = [];
      for (const l of a.lines) {
        const acc = await show(account(ctx, l.accountCode), warnings, "ai.warn.accountNotFound");
        if ((l.debit && l.credit) || (!l.debit && !l.credit)) warnings.push("ai.warn.linesInvalid");
        dr = dr.add(l.debit ?? "0");
        cr = cr.add(l.credit ?? "0");
        lines.push({ labelKey: l.debit ? "ai.col.debit" : "ai.col.credit", value: `${acc ? `${acc.code} ${acc.name}` : l.accountCode} — ${D(l.debit ?? l.credit ?? "0").toFixed(2)}` });
      }
      if (!dr.eq(cr)) warnings.push("ai.warn.unbalanced");
      return card("ai.preview.journalEntry", "journal_entry", [
        { labelKey: "ai.col.date", value: a.entryDate ?? today() },
        { labelKey: "ai.col.description", value: a.description },
        ...lines,
        { labelKey: "ai.col.totalDebit", value: dr.toFixed(2) },
        { labelKey: "ai.col.totalCredit", value: cr.toFixed(2) },
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const entryDate = a.entryDate ?? today();
      const day = new Date(`${entryDate}T00:00:00Z`);
      const period = await prisma.fiscalPeriod.findFirst({ where: { companyId: ctx.actor.companyId, startDate: { lte: day }, endDate: { gte: day } }, select: { id: true } });
      if (!period) throw actionError("NO_FISCAL_PERIOD", `No fiscal period covers ${entryDate}`);
      const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.actor.companyId }, select: { defaultCurrency: true } });
      const lines = [];
      for (const l of a.lines) {
        if ((l.debit && l.credit) || (!l.debit && !l.credit)) throw actionError("INVALID_LINE", "Each line needs either a debit or a credit");
        lines.push({ accountId: (await account(ctx, l.accountCode)).id, ...(l.debit ? { debit: l.debit } : {}), ...(l.credit ? { credit: l.credit } : {}), description: l.description ?? a.description });
      }
      const dto = await toDto(PostJournalEntryDto, { fiscalPeriodId: period.id, entryDate, postingDate: entryDate, currency: company.defaultCurrency, lines });
      const r = (await controller(AccountingController).postJournalEntry(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/accounting/journal-entries/${r.id}` } };
    },
  });

  const reverseJournalEntry = action({
    name: "accounting_reverseJournalEntry",
    description: "Reverse a posted journal entry with a reversing entry (the original stays). Needs a reason.",
    input: z.object({ entry: docRefOf("Journal entry"), reason: z.string().trim().min(3).max(300) }),
    permission: { resource: "journal_entry", action: "reverse" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const e = await show(doc(ctx, "journalEntry", a.entry), warnings, "ai.warn.documentNotFound");
      return card("ai.preview.reverseJournalEntry", "journal_entry", [{ labelKey: "ai.col.document", value: e?.number ?? a.entry }, { labelKey: "ai.col.reason", value: a.reason }], warnings);
    },
    execute: async (ctx, a) => {
      const e = await doc(ctx, "journalEntry", a.entry);
      const r = (await controller(AccountingController).reverseJournalEntry(e.id, await toDto(ReverseJournalEntryDto, { reason: a.reason }), actorOf(ctx), ctx.correlationId)) as unknown as { id?: string; number?: string };
      return { data: { reversed: e.number, ...(r.number ? { number: r.number } : {}) }, link: { label: e.number, path: `/accounting/journal-entries/${e.id}` } };
    },
  });

  // ─── 5. HR and fixed assets ────────────────────────────────────────────────────────────────────
  const salaryAdvance = action({
    name: "hr_salaryAdvance",
    description: "Grant a salary advance to an employee, repaid by monthly payroll deductions. Posts to the ledger.",
    input: z.object({ employeeId: z.string().trim().min(1).describe("Employee id or ref from employees_search"), amount: decimal, installmentAmount: decimal.describe("Deducted each month"), cashAccountCode: z.string().trim().max(40).describe("Cash/bank account it is paid from"), grantDate: date.optional() }),
    permission: { resource: "salary_advance", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const e = await show(employee(ctx, a.employeeId), warnings, "ai.warn.documentNotFound");
      const cash = await show(account(ctx, a.cashAccountCode), warnings, "ai.warn.accountNotFound");
      return card("ai.preview.salaryAdvance", "salary_advance", [
        { labelKey: "ai.col.employee", value: e?.name ?? a.employeeId },
        { labelKey: "ai.col.amount", value: D(a.amount).toFixed(2) },
        { labelKey: "ai.col.installment", value: D(a.installmentAmount).toFixed(2) },
        { labelKey: "ai.col.cashAccount", value: cash ? `${cash.code} ${cash.name}` : a.cashAccountCode },
        { labelKey: "ai.col.date", value: a.grantDate ?? today() },
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const e = await employee(ctx, a.employeeId);
      const dto = await toDto(GrantSalaryAdvanceDto, { employeeId: e.id, grantDate: a.grantDate ?? today(), amount: a.amount, installmentAmount: a.installmentAmount, cashAccountId: (await account(ctx, a.cashAccountCode)).id });
      const r = (await controller(HrController).grantAdvance(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { employee: e.name, ...(r.id ? { id: r.id } : {}) }, link: { label: e.name, path: "/hr/salary-advances" } };
    },
  });

  const payrollRun = action({
    name: "hr_payrollRun",
    description: "Run (post) the payroll for a month: accrues salaries, GOSI and advance deductions for all active employees.",
    input: z.object({ periodYear: z.number().int().min(2020).max(2100), periodMonth: z.number().int().min(1).max(12), runDate: date.optional() }),
    permission: { resource: "payroll_run", action: "create" },
    risk: "high",
    preview: async (ctx, a) => {
      const count = await prisma.employee.count({ where: { companyId: ctx.actor.companyId, isActive: true } });
      return card("ai.preview.payrollRun", "payroll_run", [
        { labelKey: "ai.col.period", value: `${a.periodYear}-${String(a.periodMonth).padStart(2, "0")}` },
        { labelKey: "ai.col.employees", value: String(count) },
        { labelKey: "ai.col.date", value: a.runDate ?? today() },
      ], []);
    },
    execute: async (ctx, a, key) => {
      const dto = await toDto(CreatePayrollRunDto, { periodYear: a.periodYear, periodMonth: a.periodMonth, runDate: a.runDate ?? today() });
      const r = (await controller(HrController).createRun(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { period: `${a.periodYear}-${a.periodMonth}`, ...(r.id ? { id: r.id } : {}) }, link: { label: `${a.periodYear}-${a.periodMonth}`, path: "/hr/payroll" } };
    },
  });

  const createFixedAsset = action({
    name: "assets_create",
    description: "Register a fixed asset as a draft (no ledger entry yet). Then capitalize it with assets_capitalize to start depreciation.",
    input: z.object({
      name: z.string().trim().min(1).max(200),
      nameAr: z.string().trim().max(200).optional(),
      categoryCode: z.string().trim().max(40).describe("Fixed asset category code; ask if unknown"),
      acquisitionDate: date,
      inServiceDate: date.optional().describe("Defaults to the acquisition date"),
      acquisitionCost: decimal,
      residualValue: decimal.optional(),
      usefulLifeMonths: z.number().int().min(1).max(1200).optional().describe("Defaults to the category's"),
      location: z.string().trim().max(200).optional(),
      serialNumber: z.string().trim().max(100).optional(),
    }),
    permission: { resource: "fixed_asset", action: "create" },
    risk: "low",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const cat = await prisma.fixedAssetCategory.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code: a.categoryCode }, { id: a.categoryCode }] }, select: { name: true, nameAr: true } });
      if (!cat) warnings.push("ai.warn.categoryNotFound");
      return card("ai.preview.createFixedAsset", "fixed_asset", [
        { labelKey: "ai.col.name", value: a.name },
        { labelKey: "ai.col.category", value: cat ? name(ctx, cat) : a.categoryCode },
        { labelKey: "ai.col.cost", value: D(a.acquisitionCost).toFixed(2) },
        { labelKey: "ai.col.date", value: a.acquisitionDate },
        ...field("ai.col.residual", a.residualValue ? D(a.residualValue).toFixed(2) : undefined),
        ...field("ai.col.usefulLife", a.usefulLifeMonths ? String(a.usefulLifeMonths) : undefined),
      ], warnings);
    },
    execute: async (ctx, a) => {
      const cat = await prisma.fixedAssetCategory.findFirst({ where: { companyId: ctx.actor.companyId, OR: [{ code: a.categoryCode }, { id: a.categoryCode }] }, select: { id: true } });
      if (!cat) throw actionError("CATEGORY_NOT_FOUND", `Category ${a.categoryCode} not found`);
      const dto = await toDto(FixedAssetDetailsDto, { ...without(a, "categoryCode"), categoryId: cat.id, inServiceDate: a.inServiceDate ?? a.acquisitionDate });
      const r = (await controller(FixedAssetsController).createDraft(dto, actorOf(ctx), ctx.correlationId)) as unknown as { id: string; number: string };
      return { data: { id: r.id, number: r.number }, link: { label: r.number, path: `/assets/${r.id}` } };
    },
  });

  const capitalizeAsset = action({
    name: "assets_capitalize",
    description: "Capitalize a draft fixed asset (posts its cost from the source account into the asset account; depreciation starts).",
    input: z.object({ asset: docRefOf("Fixed asset"), sourceAccountCode: z.string().trim().max(40).describe("Account the cost comes from (e.g. cash, a payable, or a clearing account); ask if unsure") }),
    permission: { resource: "fixed_asset", action: "capitalize" },
    risk: "high",
    preview: async (ctx, a) => {
      const warnings: string[] = [];
      const fa = await show(doc(ctx, "fixedAsset", a.asset), warnings, "ai.warn.documentNotFound");
      const row = fa ? await prisma.fixedAsset.findUnique({ where: { id: fa.id }, select: { name: true, nameAr: true, acquisitionCost: true } }) : null;
      if (fa && fa.status !== "DRAFT") warnings.push("ai.warn.notOpen");
      const src = await show(account(ctx, a.sourceAccountCode), warnings, "ai.warn.accountNotFound");
      return card("ai.preview.capitalizeAsset", "fixed_asset", [
        { labelKey: "ai.col.document", value: fa?.number ?? a.asset },
        ...field("ai.col.name", row ? name(ctx, row) : null),
        ...field("ai.col.cost", row?.acquisitionCost.toFixed(2)),
        { labelKey: "ai.col.sourceAccount", value: src ? `${src.code} ${src.name}` : a.sourceAccountCode },
      ], warnings);
    },
    execute: async (ctx, a, key) => {
      const fa = await doc(ctx, "fixedAsset", a.asset);
      const dto = await toDto(CapitalizeAssetDto, { sourceAccountId: (await account(ctx, a.sourceAccountCode)).id });
      await controller(FixedAssetsController).capitalize(fa.id, dto, actorOf(ctx), ctx.correlationId, key);
      return { data: { id: fa.id, number: fa.number, status: "ACTIVE" }, link: { label: fa.number, path: `/assets/${fa.id}` } };
    },
  });

  const depreciationRun = action({
    name: "assets_depreciationRun",
    description: "Post the monthly depreciation for all active fixed assets for a month.",
    input: z.object({ periodYear: z.number().int().min(2000).max(2200), periodMonth: z.number().int().min(1).max(12) }),
    permission: { resource: "depreciation_run", action: "post" },
    risk: "high",
    preview: async (ctx, a) => {
      const count = await prisma.fixedAsset.count({ where: { companyId: ctx.actor.companyId, status: "ACTIVE" } });
      return card("ai.preview.depreciationRun", "depreciation_run", [
        { labelKey: "ai.col.period", value: `${a.periodYear}-${String(a.periodMonth).padStart(2, "0")}` },
        { labelKey: "ai.col.assets", value: String(count) },
      ], []);
    },
    execute: async (ctx, a, key) => {
      const dto = await toDto(DepreciationPeriodDto, { periodYear: a.periodYear, periodMonth: a.periodMonth });
      const r = (await controller(FixedAssetsController).postRun(dto, actorOf(ctx), ctx.correlationId, key)) as unknown as { id?: string; number?: string };
      return { data: { period: `${a.periodYear}-${a.periodMonth}`, ...(r.id ? { id: r.id } : {}) }, link: { label: `${a.periodYear}-${a.periodMonth}`, path: "/assets/depreciation" } };
    },
  });

  return [
    cancelQuotation, rejectQuotation, convertQuotation, createSalesOrder, cancelSalesOrder, createDeliveryNote, createSalesInvoice, createCreditNote, createDebitNote,
    customerReceipt, supplierPayment, reversePayment,
    createPurchaseRequest, createPurchaseOrder, approvePurchaseOrder, cancelPurchaseOrder, receivePurchaseOrder, supplierDebitNote,
    updateItem, updateWarehouse, updateParty, stockIssue, journalEntry, reverseJournalEntry,
    salaryAdvance, payrollRun, createFixedAsset, capitalizeAsset, depreciationRun,
  ];
}
