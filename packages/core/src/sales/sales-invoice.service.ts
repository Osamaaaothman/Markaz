import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { lockStockRow, saveStockRow } from "../inventory/stock-row.repo.js";
import { InsufficientStockError, applyIssue } from "../inventory/weighted-average.util.js";
import { allocateDocumentNumber } from "../reference.js";
import type { SalesActor } from "./quotation.service.js";
import { SalesError, blankToNull, dateOnly, lockCustomer, resolveSalesLines, totalsOf, type SalesLineInput } from "./sales-lines.js";

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
}

export interface CreditNoteLineInput {
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
}

export interface SalesInvoiceResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly totalGross: string;
}

export interface SalesInvoiceSummary {
  readonly id: string;
  readonly documentType: "INVOICE" | "CREDIT_NOTE";
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
  readonly lines: readonly {
    readonly id: string;
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
  readonly documentType?: "INVOICE" | "CREDIT_NOTE" | undefined;
}

export interface SalesInvoiceListPage {
  readonly data: readonly SalesInvoiceSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

type InvoiceRow = Prisma.SalesInvoiceGetPayload<{ include: { customer: true } }>;

function toSummary(row: InvoiceRow): SalesInvoiceSummary {
  return {
    id: row.id,
    documentType: row.documentType as "INVOICE" | "CREDIT_NOTE",
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
// Credit note posting is the mirror of the revenue side only (Dr revenue, Dr output VAT, Cr receivable);
// it does NOT return goods to stock — a return to stock is a separate document not built yet.
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

    await this.audit.log({ actorId: actor.id, action: "sales_invoice.posted", entityType: "SalesInvoice", entityId: result.id, after: { ...result }, correlationId });
    return result;
  }

  async createCreditNote(
    input: CreateCreditNoteInput,
    actor: SalesActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SalesInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findFirst({ where: { id: input.originalInvoiceId, companyId: actor.companyId } });
      if (!original) throw new SalesError("NOT_FOUND", "Invoice not found");
      if (original.documentType !== "INVOICE") throw new SalesError("NOT_AN_INVOICE", "A credit note can only be raised against an invoice");
      await lockCustomer(tx, actor.companyId, original.customerId);

      const lines = await resolveSalesLines(
        tx,
        actor.companyId,
        input.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCodeId: l.taxCodeId })),
      );
      const totals = totalsOf(lines);
      if (totals.gross.isZero()) throw new SalesError("ZERO_DOCUMENT", "A credit note with nothing to credit cannot be posted");

      // Credits already raised against this invoice, plus this one, never exceed the invoice.
      const credited = await tx.salesInvoice.aggregate({
        where: { companyId: actor.companyId, originalInvoiceId: original.id },
        _sum: { totalGross: true },
      });
      const already = credited._sum.totalGross ?? new Prisma.Decimal(0);
      if (already.plus(totals.gross).greaterThan(original.totalGross)) {
        throw new SalesError("CREDIT_EXCEEDS_INVOICE", "The credit notes would be worth more than the invoice");
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.creditDate);
      if (!period) throw new SalesError("NO_OPEN_PERIOD", "No open fiscal period covers the credit note date");
      const currency = await companyCurrency(tx, actor.companyId);

      const revenueByAccount = await this.revenueByAccount(tx, actor.companyId, lines, input.lines.map((l) => l.revenueAccountId));
      const journalLines: JournalLineInput[] = [];
      for (const [accountId, amount] of revenueByAccount) {
        if (!amount.isZero()) journalLines.push({ accountId, debit: amount.toFixed(4), description: "Credit note: revenue" });
      }
      if (!totals.tax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_OUTPUT"), debit: totals.tax.toFixed(4), description: "Credit note: output VAT" });
      }
      journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_RECEIVABLE"), credit: totals.gross.toFixed(4), description: "Credit note" });

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
      return { id: noteId, number, journalEntryId: posting.journalEntryId, totalGross: totals.gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "sales_credit_note.posted", entityType: "SalesInvoice", entityId: result.id, after: { ...result }, correlationId });
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
      include: { customer: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!row) throw new SalesError("NOT_FOUND", "Invoice not found");
    return {
      ...toSummary(row),
      notes: row.notes,
      lines: row.lines.map((l) => ({
        id: l.id,
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
