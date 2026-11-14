import { invoiceAuditSnapshot } from "../audit/invoice-audit-snapshot.js";
import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { lockStockRow, saveStockRow } from "../inventory/stock-row.repo.js";
import { InsufficientStockError, applyIssue } from "../inventory/weighted-average.util.js";
import { returnShare } from "../inventory/return-amount.util.js";
import { writeOutboxMessage } from "../outbox/outbox-writer.js";
import { allocateDocumentNumber } from "../reference.js";
import type { SalesActor } from "./quotation.service.js";
import { SalesError, blankToNull, dateOnly, lockCustomer, resolveEgsUnitId, resolveSalesLines, totalsOf, type SalesLineInput } from "./sales-lines.js";

export interface SalesInvoiceLineInput extends SalesLineInput {
  // Required with an item: the warehouse the goods leave.
  readonly warehouseId?: string | undefined;
  readonly salesOrderLineId?: string | undefined;
  // Post this line's revenue to its own account instead of the mapped default.
  readonly revenueAccountId?: string | undefined;
}

export interface CreateSalesInvoiceInput {
  readonly customerId: string;
  readonly invoiceDate: Date;
  readonly dueDate?: Date | undefined;
  readonly notes?: string | undefined;
  readonly lines: readonly SalesInvoiceLineInput[];
  // Required only when the company has more than one active ZATCA issuing unit (EgsUnit);
  // omit it otherwise (docs/01-OPEN-DECISIONS.md).
  readonly egsUnitId?: string | undefined;
  // UNCL4461 payment means code ZATCA requires on every document (10=cash, 42=bank transfer,
  // 48=card). Omitted = "42", the schema default.
  readonly paymentMeansCode?: string | undefined;
}

export interface CreditNoteLineInput {
  readonly warehouseId?: string | undefined;
  readonly originalLineId?: string | undefined;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly revenueAccountId?: string | undefined;
}

export interface CreateCreditNoteInput {
  readonly originalInvoiceId: string;
  readonly creditDate: Date;
  readonly notes?: string | undefined;
  readonly lines: readonly CreditNoteLineInput[];
  readonly egsUnitId?: string | undefined;
  readonly paymentMeansCode?: string | undefined;
}

// Free-typed lines against a revenue account, the AR mirror of the purchasing debit note (D8):
// docs/01-OPEN-DECISIONS.md section E.
export interface SalesDebitNoteLineInput {
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly revenueAccountId?: string | undefined;
}

export interface CreateSalesDebitNoteInput {
  readonly originalInvoiceId: string;
  readonly debitDate: Date;
  readonly notes?: string | undefined;
  readonly lines: readonly SalesDebitNoteLineInput[];
  readonly egsUnitId?: string | undefined;
  readonly paymentMeansCode?: string | undefined;
}

export interface SalesInvoiceResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly totalGross: string;
}

export interface SalesInvoiceSummary {
  readonly id: string;
  readonly documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  readonly number: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly originalInvoiceId: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SalesInvoiceDetail extends SalesInvoiceSummary {
  readonly notes: string | null;
  // Printed on the PDF header, next to the customer's name (docs/08 — never required to
  // post an invoice; a customer without these on file simply shows nothing for them).
  readonly customerVatNumber: string | null;
  readonly customerCommercialRegistration: string | null;
  readonly customerStreetName: string | null;
  readonly customerAdditionalStreetName: string | null;
  readonly customerBuildingNumber: string | null;
  readonly customerAdditionalNumber: string | null;
  readonly customerDistrict: string | null;
  readonly customerCity: string | null;
  readonly customerPostalCode: string | null;
  readonly lines: readonly {
    readonly id: string;
    readonly taxCodeId: string;
    readonly returnableQuantity: string;
    readonly itemId: string | null;
    readonly warehouseId: string | null;
    readonly warehouseName: string | null;
    readonly warehouseNameAr: string | null;
    readonly originalLineId: string | null;
    readonly description: string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly netAmount: string;
    readonly taxRate: string;
    readonly taxAmount: string;
  }[];
}

export interface SalesInvoiceListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly customerId?: string | undefined;
  readonly documentType?: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | undefined;
}

export interface SalesInvoiceListPage {
  readonly data: readonly SalesInvoiceSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

type InvoiceRow = Prisma.SalesInvoiceGetPayload<{ include: { customer: true } }>;

function toSummary(row: InvoiceRow): SalesInvoiceSummary {
  return {
    id: row.id,
    documentType: row.documentType as "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE",
    number: row.number,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerNameAr: row.customer.nameAr,
    originalInvoiceId: row.originalInvoiceId,
    invoiceDate: dateOnly(row.invoiceDate),
    dueDate: row.dueDate ? dateOnly(row.dueDate) : null,
    currency: row.currency,
    totalNet: row.totalNet.toFixed(4),
    totalTax: row.totalTax.toFixed(4),
    totalGross: row.totalGross.toFixed(4),
  };
}

// Sales invoices and credit notes.
//
// Invoice posting:
//   Dr Accounts receivable   gross
//   Cr Sales revenue         net            (per line: the mapped account, or the line's own)
//   Cr Output VAT            tax
//   Dr Cost of goods sold    cost of the stock sold, at the item's weighted-average cost
//   Cr Inventory             the same cost
// Stock leaves the named warehouse in the same transaction; a line asking for more than is on hand
// fails the whole invoice (no negative stock). A sale never posts a loss to hide a missing cost: the
// cost is whatever the weighted average is, even when that is zero.
//
// Linked credit notes reverse original revenue and VAT and restore stock at its historical cost.
// Unlinked credit notes remain financial adjustments.
export class SalesInvoiceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async createInvoice(
    input: CreateSalesInvoiceInput,
    actor: SalesActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCustomer(tx, actor.companyId, input.customerId);
      const egsUnitId = await resolveEgsUnitId(tx, actor.companyId, input.egsUnitId);
      const lines = await resolveSalesLines(tx, actor.companyId, input.lines);

      // ── order lines: lock, check the remaining quantity ──
      const orderLineIds = [...new Set(input.lines.flatMap((l) => (l.salesOrderLineId ? [l.salesOrderLineId] : [])))];
      if (orderLineIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM sales_order_lines WHERE id = ANY(${orderLineIds}::text[]) ORDER BY id FOR UPDATE`;
      }
      const orderLines = await tx.salesOrderLine.findMany({ where: { id: { in: orderLineIds } }, include: { salesOrder: true } });
      const orderLineById = new Map(orderLines.map((l) => [l.id, l]));
      const claimed = new Map<string, Prisma.Decimal>();
      input.lines.forEach((line, index) => {
        if (!line.salesOrderLineId) return;
        const orderLine = orderLineById.get(line.salesOrderLineId);
        const lineNumber = index + 1;
        if (!orderLine || orderLine.salesOrder.companyId !== actor.companyId) throw new SalesError("ORDER_LINE_NOT_FOUND", "An order line was not found", lineNumber);
        if (orderLine.salesOrder.customerId !== input.customerId) throw new SalesError("CUSTOMER_MISMATCH", "An order line belongs to a different customer", lineNumber);
        if (orderLine.salesOrder.status === "CANCELLED" || orderLine.salesOrder.status === "INVOICED") {
          throw new SalesError("INVALID_STATE", "That sales order is closed", lineNumber);
        }
        const quantity = new Prisma.Decimal(line.quantity);
        const used = (claimed.get(orderLine.id) ?? new Prisma.Decimal(0)).plus(quantity);
        claimed.set(orderLine.id, used);
        if (used.greaterThan(orderLine.quantity.minus(orderLine.invoicedQuantity))) {
          throw new SalesError("OVER_INVOICED", "More than the quantity still to invoice on the order", lineNumber);
        }
      });

      // ── stock lines: take the goods out at weighted-average cost ──
      const costByLine = new Map<number, { unitCost: Prisma.Decimal; value: Prisma.Decimal; warehouseId: string }>();
      for (const line of lines) {
        const input_ = input.lines[line.lineNumber - 1]!;
        if (line.itemId === null) continue;
        if (!input_.warehouseId) throw new SalesError("WAREHOUSE_REQUIRED", "A line with an item needs a warehouse", line.lineNumber);
        const warehouse = await tx.warehouse.findFirst({ where: { id: input_.warehouseId, companyId: actor.companyId, isActive: true }, select: { id: true } });
        if (!warehouse) throw new SalesError("WAREHOUSE_NOT_FOUND", "A warehouse on the invoice was not found", line.lineNumber);
        const stock = await lockStockRow(tx, actor.companyId, line.itemId, warehouse.id);
        let issued;
        try {
          issued = applyIssue(stock.state, line.quantity);
        } catch (error) {
          if (error instanceof InsufficientStockError) throw new SalesError("INSUFFICIENT_STOCK", error.message, line.lineNumber);
          throw error;
        }
        await saveStockRow(tx, stock.id, issued.state);
        costByLine.set(line.lineNumber, { unitCost: issued.unitCost, value: issued.value, warehouseId: warehouse.id });
      }
      const totalCost = [...costByLine.values()].reduce((sum, c) => sum.plus(c.value), new Prisma.Decimal(0));

      const totals = totalsOf(lines);
      if (totals.gross.isZero()) throw new SalesError("ZERO_DOCUMENT", "An invoice with nothing to pay cannot be posted");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.invoiceDate);
      if (!period) throw new SalesError("NO_OPEN_PERIOD", "No open fiscal period covers the invoice date");
      const currency = await companyCurrency(tx, actor.companyId);

      // ── journal ──
      const revenueByAccount = await this.revenueByAccount(tx, actor.companyId, lines, input.lines.map((l) => l.revenueAccountId));
      const journalLines: JournalLineInput[] = [
        { accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_RECEIVABLE"), debit: totals.gross.toFixed(4), description: "Sales invoice" },
      ];
      for (const [accountId, amount] of revenueByAccount) {
        if (!amount.isZero()) journalLines.push({ accountId, credit: amount.toFixed(4), description: "Sales revenue" });
      }
      if (!totals.tax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_OUTPUT"), credit: totals.tax.toFixed(4), description: "Output VAT" });
      }
      if (!totalCost.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "COST_OF_GOODS_SOLD"), debit: totalCost.toFixed(4), description: "Cost of goods sold" });
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY"), credit: totalCost.toFixed(4), description: "Cost of goods sold" });
      }

      const invoiceId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.invoiceDate,
          postingDate: input.invoiceDate,
          currency,
          lines: journalLines,
          sourceModule: "sales",
          sourceDocumentType: "sales_invoice",
          sourceDocumentId: invoiceId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      // The ledger numbers its entries under the source document type; the invoice has its own series.
      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.invoiceDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "sales_invoice_no", "INV", fiscalYear);
      const orderIds = [...new Set(orderLines.map((l) => l.salesOrderId))];

      await tx.salesInvoice.create({
        data: {
          id: invoiceId,
          companyId: actor.companyId,
          documentType: "INVOICE",
          number,
          customerId: input.customerId,
          salesOrderId: orderIds.length === 1 ? (orderIds[0] ?? null) : null,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? input.invoiceDate,
          currency,
          totalNet: totals.net,
          totalTax: totals.tax,
          totalGross: totals.gross,
          totalCost,
          journalEntryId: posting.journalEntryId,
          notes: blankToNull(input.notes),
          egsUnitId,
          paymentMeansCode: input.paymentMeansCode ?? "42",
          actorId: actor.id,
          correlationId,
          lines: {
            create: lines.map((l) => {
              const source = input.lines[l.lineNumber - 1]!;
              const cost = costByLine.get(l.lineNumber);
              return {
                id: newId(),
                salesOrderLineId: source.salesOrderLineId ?? null,
                itemId: l.itemId,
                warehouseId: cost?.warehouseId ?? null,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                netAmount: l.net,
                taxCodeId: l.taxCodeId,
                taxRate: l.taxRate,
                taxAmount: l.tax,
                costValue: cost?.value ?? new Prisma.Decimal(0),
                revenueAccountId: source.revenueAccountId ?? null,
                lineNumber: l.lineNumber,
              };
            }),
          },
        },
      });

      // docs/06 §4: the intent to submit is written in the same transaction as the document, so a
      // rollback of the invoice also rolls the submission back. The worker (apps/api/src/worker.ts)
      // consumes `zatca-submission-<egsUnitId>` for the EGS unit this document was issued by.
      if (egsUnitId !== null) {
        await writeOutboxMessage(tx, {
          companyId: actor.companyId,
          topic: `zatca-submission-${egsUnitId}`,
          payload: { salesInvoiceId: invoiceId, egsUnitId },
          correlationId,
        });
      }

      await tx.stockMovement.createMany({
        data: lines.flatMap((l) => {
          const cost = costByLine.get(l.lineNumber);
          if (!cost || l.itemId === null) return [];
          return [
            {
              id: newId(),
              companyId: actor.companyId,
              itemId: l.itemId,
              warehouseId: cost.warehouseId,
              movementType: "ISSUE",
              quantity: l.quantity.negated(),
              unitCost: cost.unitCost,
              value: cost.value,
              sourceDocumentType: "sales_invoice",
              sourceDocumentId: invoiceId,
              journalEntryId: posting.journalEntryId,
              actorId: actor.id,
              correlationId,
            },
          ];
        }),
      });

      // ── order counters and status ──
      for (const [lineId, quantity] of claimed) {
        await tx.salesOrderLine.update({ where: { id: lineId }, data: { invoicedQuantity: { increment: quantity } } });
      }
      for (const orderId of orderIds) {
        const all = await tx.salesOrderLine.findMany({ where: { salesOrderId: orderId }, select: { quantity: true, invoicedQuantity: true } });
        const done = all.every((l) => l.invoicedQuantity.greaterThanOrEqualTo(l.quantity));
        await tx.salesOrder.update({ where: { id: orderId }, data: { status: done ? "INVOICED" : "PARTIALLY_INVOICED", version: { increment: 1 } } });
      }

      return { id: invoiceId, number, journalEntryId: posting.journalEntryId, totalGross: totals.gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "sales_invoice.posted", entityType: "SalesInvoice", entityId: result.id, after: { ...result, ...await invoiceAuditSnapshot(this.prisma, actor.companyId, result.id, "sales") }, correlationId });
    return result;
  }

  async createCreditNote(
    input: CreateCreditNoteInput,
    actor: SalesActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Invoice tables are immutable for the runtime role; serialize returns without UPDATE privileges.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.companyId + ":sales-return:" + input.originalInvoiceId}, 0))::text`;
      const original = await tx.salesInvoice.findFirst({ where: { id: input.originalInvoiceId, companyId: actor.companyId }, include: { lines: { include: { returnLines: true } } } });
      if (!original) throw new SalesError("NOT_FOUND", "Invoice not found");
      const previous = await tx.journalEntry.findUnique({ where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey } } });
      if (previous) {
        const note = await tx.salesInvoice.findFirst({ where: { journalEntryId: previous.id, originalInvoiceId: original.id, companyId: actor.companyId, documentType: "CREDIT_NOTE" } });
        if (!note) throw new SalesError("INVALID_RETURN", "Submission key belongs to a different document");
        return { id: note.id, number: note.number, journalEntryId: previous.id, totalGross: note.totalGross.toFixed(4) };
      }
      if (original.documentType !== "INVOICE") throw new SalesError("NOT_AN_INVOICE", "A credit note can only be raised against an invoice");
      await lockCustomer(tx, actor.companyId, original.customerId);
      // A credit note inherits the original invoice's issuing unit by default -- it is the same
      // legal document lineage, not a fresh choice -- unless the caller explicitly overrides it.
      const egsUnitId = input.egsUnitId ? await resolveEgsUnitId(tx, actor.companyId, input.egsUnitId) : original.egsUnitId;

      const linked = input.lines.some((l) => l.originalLineId !== undefined);
      const seen = new Set<string>();
      const sources = input.lines.map((line) => {
        if (!linked) {
          if (line.warehouseId !== undefined) throw new SalesError("INVALID_RETURN", "A warehouse requires an original stock invoice line");
          return null;
        }
        const source = original.lines.find((l) => l.id === line.originalLineId);
        if (!source || seen.has(source.id)) throw new SalesError("INVALID_RETURN", "Choose distinct lines from the original invoice");
        seen.add(source.id);
        const quantity = new Prisma.Decimal(line.quantity);
        const returned = source.returnLines.reduce((sum, l) => sum.plus(l.quantity), new Prisma.Decimal(0));
        if (!quantity.isFinite() || quantity.decimalPlaces() > 4 || !quantity.greaterThan(0) || quantity.plus(returned).greaterThan(source.quantity)) {
          throw new SalesError("OVER_RETURN", "The return quantity exceeds the remaining invoice quantity");
        }
        if (!source.itemId && line.warehouseId !== undefined) throw new SalesError("INVALID_RETURN", "Service returns cannot move stock");
        const warehouseId = source.itemId ? line.warehouseId ?? source.warehouseId : null;
        if (source.itemId && !warehouseId) throw new SalesError("WAREHOUSE_REQUIRED", "Choose a warehouse for returned goods");
        return { source, quantity, returned, warehouseId, cost: returnShare(source.costValue, source.quantity, returned, quantity) };
      });
      if (linked && input.creditDate < original.invoiceDate) throw new SalesError("INVALID_RETURN", "Return date cannot precede the invoice");
      const lines = linked ? sources.map((entry, index) => {
        const { source, quantity, returned } = entry!;
        return { itemId: source.itemId, description: source.description, quantity, unitPrice: source.unitPrice,
          taxCodeId: source.taxCodeId, taxRate: source.taxRate,
          net: returnShare(source.netAmount, source.quantity, returned, quantity),
          tax: returnShare(source.taxAmount, source.quantity, returned, quantity), lineNumber: index + 1 };
      }) : await resolveSalesLines(tx, actor.companyId, input.lines);
      const totals = totalsOf(lines);
      if (totals.gross.isZero()) throw new SalesError("ZERO_DOCUMENT", "A credit note with nothing to credit cannot be posted");

      // Credits already raised against this invoice, plus this one, never exceed the invoice.
      // Scoped to CREDIT_NOTE: a debit note (below) also sets originalInvoiceId, and must not count here.
      const credited = await tx.salesInvoice.aggregate({
        where: { companyId: actor.companyId, originalInvoiceId: original.id, documentType: "CREDIT_NOTE" },
        _sum: { totalGross: true },
      });
      const already = credited._sum.totalGross ?? new Prisma.Decimal(0);
      if (already.plus(totals.gross).greaterThan(original.totalGross)) {
        throw new SalesError("CREDIT_EXCEEDS_INVOICE", "The credit notes would be worth more than the invoice");
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.creditDate);
      if (!period) throw new SalesError("NO_OPEN_PERIOD", "No open fiscal period covers the credit note date");
      const currency = linked ? original.currency : await companyCurrency(tx, actor.companyId);

      const revenueByAccount = await this.revenueByAccount(tx, actor.companyId, lines, input.lines.map((l, i) => linked ? sources[i]!.source.revenueAccountId ?? undefined : l.revenueAccountId));
      const journalLines: JournalLineInput[] = [];
      for (const [accountId, amount] of revenueByAccount) {
        if (!amount.isZero()) journalLines.push({ accountId, debit: amount.toFixed(4), description: "Credit note: revenue" });
      }
      if (!totals.tax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_OUTPUT"), debit: totals.tax.toFixed(4), description: "Credit note: output VAT" });
      }
      journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_RECEIVABLE"), credit: totals.gross.toFixed(4), description: "Credit note" });

      // Restore historical cost into the selected destination, never the selling price.
      const destinationIds = [...new Set(sources.flatMap((entry) => entry?.warehouseId ? [entry.warehouseId] : []))];
      const destinations = await tx.warehouse.findMany({ where: { id: { in: destinationIds }, companyId: actor.companyId, isActive: true }, select: { id: true } });
      if (destinations.length !== destinationIds.length) throw new SalesError("WAREHOUSE_NOT_FOUND", "Choose an active warehouse belonging to this company");
      const stockReturns = sources.filter((entry) => entry?.source.itemId && entry.warehouseId)
        .sort((a, b) => (a!.source.itemId! + a!.warehouseId!).localeCompare(b!.source.itemId! + b!.warehouseId!));
      let restoredCost = new Prisma.Decimal(0);
      for (const entry of stockReturns) {
        const { source, quantity, cost, warehouseId } = entry!;
        const stock = await lockStockRow(tx, actor.companyId, source.itemId!, warehouseId!);
        await saveStockRow(tx, stock.id, { quantity: stock.state.quantity.plus(quantity), value: stock.state.value.plus(cost) });
        restoredCost = restoredCost.plus(cost);
      }
      if (restoredCost.greaterThan(0)) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY"), debit: restoredCost.toFixed(4), description: "Sales return: stock restored" });
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "COST_OF_GOODS_SOLD"), credit: restoredCost.toFixed(4), description: "Sales return: cost reversed" });
      }

      const noteId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.creditDate,
          postingDate: input.creditDate,
          currency,
          lines: journalLines,
          sourceModule: "sales",
          sourceDocumentType: "sales_credit_note",
          sourceDocumentId: noteId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.creditDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "sales_credit_note_no", "CN", fiscalYear);
      await tx.salesInvoice.create({
        data: {
          id: noteId,
          companyId: actor.companyId,
          documentType: "CREDIT_NOTE",
          number,
          customerId: original.customerId,
          originalInvoiceId: original.id,
          invoiceDate: input.creditDate,
          dueDate: null,
          currency,
          totalNet: totals.net,
          totalTax: totals.tax,
          totalGross: totals.gross,
          journalEntryId: posting.journalEntryId,
          notes: blankToNull(input.notes),
          egsUnitId,
          paymentMeansCode: input.paymentMeansCode ?? "42",
          actorId: actor.id,
          correlationId,
          lines: {
            create: lines.map((l) => ({
              id: newId(),
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.net,
              taxCodeId: l.taxCodeId,
              taxRate: l.taxRate,
              taxAmount: l.tax,
              originalLineId: sources[l.lineNumber - 1]?.source.id ?? null,
              itemId: sources[l.lineNumber - 1]?.source.itemId ?? null,
              warehouseId: sources[l.lineNumber - 1]?.warehouseId ?? null,
              costValue: sources[l.lineNumber - 1]?.cost ?? new Prisma.Decimal(0),
              revenueAccountId: linked ? sources[l.lineNumber - 1]!.source.revenueAccountId : input.lines[l.lineNumber - 1]?.revenueAccountId ?? null,
              lineNumber: l.lineNumber,
            })),
          },
        },
      });
      if (egsUnitId !== null) {
        await writeOutboxMessage(tx, {
          companyId: actor.companyId,
          topic: `zatca-submission-${egsUnitId}`,
          payload: { salesInvoiceId: noteId, egsUnitId },
          correlationId,
        });
      }
      if (stockReturns.length) await tx.stockMovement.createMany({ data: stockReturns.map((entry) => {
        const { source, quantity, cost, warehouseId } = entry!;
        return { id: newId(), companyId: actor.companyId, itemId: source.itemId!, warehouseId: warehouseId!,
          movementType: "RETURN", quantity, unitCost: cost.div(quantity).toDecimalPlaces(4), value: cost,
          sourceDocumentType: "sales_credit_note", sourceDocumentId: noteId, journalEntryId: posting.journalEntryId, actorId: actor.id, correlationId };
      }) });
      return { id: noteId, number, journalEntryId: posting.journalEntryId, totalGross: totals.gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "sales_credit_note.posted", entityType: "SalesInvoice", entityId: result.id, after: { ...result, ...await invoiceAuditSnapshot(this.prisma, actor.companyId, result.id, "sales") }, correlationId });
    return result;
  }

  // The AR mirror of the purchasing debit note (packages/core/src/purchasing/supplier-invoice.service.ts
  // createDebitNote, decision D8): free-typed lines billed against an invoice to increase what the
  // customer owes. // REVIEW: bounding debit notes to the original invoice's gross, the same choice
  // D8 made for suppliers, is not an accountant's ruling — confirm before the first real one posts.
  async createDebitNote(
    input: CreateSalesDebitNoteInput,
    actor: SalesActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findFirst({ where: { id: input.originalInvoiceId, companyId: actor.companyId } });
      if (!original) throw new SalesError("NOT_FOUND", "Invoice not found");
      if (original.documentType !== "INVOICE") throw new SalesError("NOT_AN_INVOICE", "A debit note can only be raised against an invoice");
      await lockCustomer(tx, actor.companyId, original.customerId);
      // Same inheritance rule as a credit note (above): defaults to the original invoice's unit.
      const egsUnitId = input.egsUnitId ? await resolveEgsUnitId(tx, actor.companyId, input.egsUnitId) : original.egsUnitId;

      const lines = await resolveSalesLines(
        tx,
        actor.companyId,
        input.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: l.taxCodeId })),
      );
      const totals = totalsOf(lines);
      if (totals.gross.isZero()) throw new SalesError("ZERO_DOCUMENT", "A debit note with nothing to debit cannot be posted");

      // Debit notes already raised against this invoice, plus this one, never exceed the invoice —
      // the same symmetric rule as credit notes (above) and the purchasing debit note (D8).
      const debited = await tx.salesInvoice.aggregate({
        where: { companyId: actor.companyId, originalInvoiceId: original.id, documentType: "DEBIT_NOTE" },
        _sum: { totalGross: true },
      });
      const already = debited._sum.totalGross ?? new Prisma.Decimal(0);
      if (already.plus(totals.gross).greaterThan(original.totalGross)) {
        throw new SalesError("DEBIT_EXCEEDS_INVOICE", "The debit notes would be worth more than the invoice");
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.debitDate);
      if (!period) throw new SalesError("NO_OPEN_PERIOD", "No open fiscal period covers the debit note date");
      const currency = await companyCurrency(tx, actor.companyId);

      const revenueByAccount = await this.revenueByAccount(tx, actor.companyId, lines, input.lines.map((l) => l.revenueAccountId));
      const journalLines: JournalLineInput[] = [
        { accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_RECEIVABLE"), debit: totals.gross.toFixed(4), description: "Debit note" },
      ];
      for (const [accountId, amount] of revenueByAccount) {
        if (!amount.isZero()) journalLines.push({ accountId, credit: amount.toFixed(4), description: "Debit note: revenue" });
      }
      if (!totals.tax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_OUTPUT"), credit: totals.tax.toFixed(4), description: "Debit note: output VAT" });
      }

      const noteId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.debitDate,
          postingDate: input.debitDate,
          currency,
          lines: journalLines,
          sourceModule: "sales",
          sourceDocumentType: "sales_debit_note",
          sourceDocumentId: noteId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.debitDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "sales_debit_note_no", "SDN", fiscalYear);
      await tx.salesInvoice.create({
        data: {
          id: noteId,
          companyId: actor.companyId,
          documentType: "DEBIT_NOTE",
          number,
          customerId: original.customerId,
          originalInvoiceId: original.id,
          invoiceDate: input.debitDate,
          dueDate: null,
          currency,
          totalNet: totals.net,
          totalTax: totals.tax,
          totalGross: totals.gross,
          journalEntryId: posting.journalEntryId,
          notes: blankToNull(input.notes),
          egsUnitId,
          paymentMeansCode: input.paymentMeansCode ?? "42",
          actorId: actor.id,
          correlationId,
          lines: {
            create: lines.map((l) => ({
              id: newId(),
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.net,
              taxCodeId: l.taxCodeId,
              taxRate: l.taxRate,
              taxAmount: l.tax,
              revenueAccountId: input.lines[l.lineNumber - 1]?.revenueAccountId ?? null,
              lineNumber: l.lineNumber,
            })),
          },
        },
      });
      if (egsUnitId !== null) {
        await writeOutboxMessage(tx, {
          companyId: actor.companyId,
          topic: `zatca-submission-${egsUnitId}`,
          payload: { salesInvoiceId: noteId, egsUnitId },
          correlationId,
        });
      }
      return { id: noteId, number, journalEntryId: posting.journalEntryId, totalGross: totals.gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "sales_debit_note.posted", entityType: "SalesInvoice", entityId: result.id, after: { ...result, ...await invoiceAuditSnapshot(this.prisma, actor.companyId, result.id, "sales") }, correlationId });
    return result;
  }

  async list(companyId: string, query: SalesInvoiceListQuery): Promise<SalesInvoiceListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
      },
      include: { customer: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(companyId: string, id: string): Promise<SalesInvoiceDetail> {
    const row = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId },
      include: { customer: true, lines: { orderBy: { lineNumber: "asc" }, include: { returnLines: true, warehouse: { select: { name: true, nameAr: true } } } } },
    });
    if (!row) throw new SalesError("NOT_FOUND", "Invoice not found");
    return {
      ...toSummary(row),
      notes: row.notes,
      customerVatNumber: row.customer.vatNumber,
      customerCommercialRegistration: row.customer.commercialRegistration,
      customerStreetName: row.customer.streetName,
      customerAdditionalStreetName: row.customer.additionalStreetName,
      customerBuildingNumber: row.customer.buildingNumber,
      customerAdditionalNumber: row.customer.additionalNumber,
      customerDistrict: row.customer.district,
      customerCity: row.customer.city,
      customerPostalCode: row.customer.postalCode,
      lines: row.lines.map((l) => ({
        id: l.id,
        taxCodeId: l.taxCodeId,
        originalLineId: l.originalLineId,
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse?.name ?? null,
        warehouseNameAr: l.warehouse?.nameAr ?? null,
        returnableQuantity: l.quantity.minus(l.returnLines.reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0))).toFixed(4),
        description: l.description,
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        netAmount: l.netAmount.toFixed(4),
        taxRate: l.taxRate.toFixed(4),
        taxAmount: l.taxAmount.toFixed(4),
      })),
    };
  }

  // Net revenue grouped by the account it posts to: a line's own account if it names one (it must be a
  // postable account of this company), otherwise the mapped SALES_REVENUE account.
  private async revenueByAccount(
    tx: TransactionClient,
    companyId: string,
    lines: readonly { net: Prisma.Decimal; lineNumber: number }[],
    overrides: readonly (string | undefined)[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const overrideIds = [...new Set(overrides.filter((id): id is string => !!id))];
    const accounts = await tx.account.findMany({ where: { id: { in: overrideIds }, companyId } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    let defaultAccountId: string | null = null;
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const override = overrides[line.lineNumber - 1];
      let accountId: string;
      if (override) {
        const account = accountById.get(override);
        if (!account) throw new SalesError("ACCOUNT_NOT_FOUND", "A revenue account on the document was not found", line.lineNumber);
        if (!account.isPostable) throw new SalesError("ACCOUNT_NOT_POSTABLE", "A revenue account on the document is a group, not a postable account", line.lineNumber);
        accountId = account.id;
      } else {
        defaultAccountId ??= await this.accountMappings.resolve(tx, companyId, "SALES_REVENUE");
        accountId = defaultAccountId;
      }
      totals.set(accountId, (totals.get(accountId) ?? new Prisma.Decimal(0)).plus(line.net));
    }
    return totals;
  }
}
