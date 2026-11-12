import { invoiceAuditSnapshot } from "../audit/invoice-audit-snapshot.js";
import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { returnShare } from "../inventory/return-amount.util.js";
import { lockStockRow, saveStockRow } from "../inventory/stock-row.repo.js";
import { applyIssue, InsufficientStockError } from "../inventory/weighted-average.util.js";
import { loadOutstanding } from "../payments/outstanding.js";
import { allocateDocumentNumber } from "../reference.js";
import { expenseLineMath, invoiceTotals, poLineMath, type PoLineMath } from "./supplier-invoice.util.js";

export type SupplierInvoiceErrorCode =
  | "INVALID_RETURN"
  | "OVER_RETURN"
  | "WAREHOUSE_NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "EMPTY_INVOICE"
  | "SUPPLIER_NOT_FOUND"
  | "PO_LINE_NOT_FOUND"
  | "SUPPLIER_MISMATCH"
  | "QTY_EXCEEDS_RECEIVED"
  | "PRICE_VARIANCE_NOT_ACCEPTED"
  | "TAX_CODE_NOT_FOUND"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_POSTABLE"
  | "DUPLICATE_INVOICE"
  | "NO_OPEN_PERIOD"
  | "ZERO_INVOICE"
  | "INVOICE_NOT_FOUND"
  | "NOT_AN_INVOICE"
  | "DEBIT_EXCEEDS_INVOICE";

export class SupplierInvoiceError extends Error {
  constructor(
    readonly code: SupplierInvoiceErrorCode,
    message: string,
    // The 1-based invoice line the problem is on, when it belongs to one.
    readonly lineNumber?: number,
  ) {
    super(message);
    this.name = "SupplierInvoiceError";
  }
}

export interface SupplierInvoiceLineInput {
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly purchaseOrderLineId?: string | undefined;
  readonly accountId?: string | undefined;
  readonly description?: string | undefined;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
}

export interface SupplierInvoiceInput {
  readonly supplierId: string;
  readonly supplierInvoiceNumber: string;
  readonly invoiceDate: Date;
  readonly dueDate?: Date | undefined;
  readonly notes?: string | undefined;
  // The buyer has seen the price differences against the order and agrees to book them.
  readonly acceptPriceVariance?: boolean | undefined;
  readonly lines: readonly SupplierInvoiceLineInput[];
}

export interface SupplierInvoiceActor {
  readonly id: string;
  readonly companyId: string;
}

export interface InvoicePreviewLine {
  readonly lineNumber: number;
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly orderPrice: string | null;
  readonly net: string;
  readonly taxRate: string;
  readonly tax: string;
  readonly priceVariance: string;
  // PO lines only: what has arrived and is not yet invoiced, before this invoice.
  readonly invoiceableQuantity: string | null;
  readonly issue: "QTY_EXCEEDS_RECEIVED" | null;
}

export interface InvoicePreview {
  readonly lines: readonly InvoicePreviewLine[];
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly totalPriceVariance: string;
  readonly hasPriceVariance: boolean;
  readonly canPost: boolean;
}

export interface SupplierInvoiceResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly totalGross: string;
}

// One line of an invoice as it was posted: an order line (an item received and priced) or a direct expense.
export interface SupplierInvoiceLineDetail {
  readonly id: string;
  readonly taxCodeId: string;
  readonly originalLineId: string | null;
  readonly returnableQuantity: string;
  readonly lineNumber: number;
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly itemNameAr: string | null;
  readonly accountCode: string | null;
  readonly accountName: string | null;
  readonly accountNameAr: string | null;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly netAmount: string;
  readonly taxCode: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly priceVariance: string;
}

export interface SupplierInvoiceDetail extends SupplierInvoiceSummary {
  readonly notes: string | null;
  readonly purchaseOrderId: string | null;
  readonly purchaseOrderNumber: string | null;
  readonly originalInvoiceNumber: string | null;
  readonly journalEntryId: string;
  readonly lines: readonly SupplierInvoiceLineDetail[];
  // Payments set against this invoice, and the debit notes raised against it.
  readonly payments: readonly { readonly paymentId: string; readonly number: string; readonly paymentDate: string; readonly amount: string }[];
  readonly debitNotes: readonly { readonly id: string; readonly number: string; readonly totalGross: string }[];
  // What is still owed (invoice only; null for a debit note), by the one definition payments and ageing use.
  readonly outstanding: string | null;
}

export interface SupplierInvoiceSummary {
  readonly id: string;
  readonly documentType: "INVOICE" | "DEBIT_NOTE";
  readonly number: string;
  readonly supplierInvoiceNumber: string | null;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly originalInvoiceId: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface DebitNoteLineInput {
  readonly originalLineId?: string | undefined;
  readonly warehouseId?: string | undefined;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly accountId: string;
}

export interface CreateDebitNoteInput {
  readonly originalInvoiceId: string;
  readonly debitDate: Date;
  readonly notes?: string | undefined;
  readonly lines: readonly DebitNoteLineInput[];
}

export interface SupplierInvoiceListPage {
  readonly data: readonly SupplierInvoiceSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface SupplierInvoiceListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly documentType?: "INVOICE" | "DEBIT_NOTE" | undefined;
}

export interface InvoiceableLine {
  readonly purchaseOrderLineId: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderNumber: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly unit: string;
  readonly orderPrice: string;
  readonly invoiceableQuantity: string;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

interface EvaluatedLine {
  readonly input: SupplierInvoiceLineInput;
  readonly lineNumber: number;
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly taxCode: { id: string; rate: Prisma.Decimal };
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
  readonly priceVariance: Prisma.Decimal;
  readonly po: PoLineMath | null;
  readonly poLine: { id: string; purchaseOrderId: string; invoiceable: Prisma.Decimal; orderPrice: Prisma.Decimal; description: string } | null;
  readonly account: { id: string; description: string } | null;
  readonly issue: "QTY_EXCEEDS_RECEIVED" | null;
}

// A supplier invoice, matched three ways: against the order (the agreed price), the receipt (what
// actually arrived) and the invoice itself. Posting:
//   Dr GRNI                     quantity x ORDER price   (clears what the receipt credited)
//   Dr/Cr Purchase price variance   invoice net - order value
//   Dr expense account          for lines with no order
//   Dr Input VAT                tax
//   Cr Accounts payable         gross
// More than was received (and not yet invoiced) is refused; a price difference is shown and must be
// accepted explicitly — neither is absorbed silently (docs/14 M5 gate).
//
// REVIEW (accounting judgement, for the accountant): a price difference is booked to a price-variance
// account rather than re-costing stock; input VAT is treated as fully recoverable; there is no
// tolerance — any difference needs acceptance. The shape of each is isolated here and in the util.
export class SupplierInvoiceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  // What can still be invoiced for this supplier: order lines with goods received and not yet invoiced.
  async listInvoiceable(companyId: string, supplierId: string): Promise<InvoiceableLine[]> {
    const rows = await this.prisma.purchaseOrderLine.findMany({
      where: { purchaseOrder: { companyId, supplierId }, receivedQuantity: { gt: 0 } },
      include: { item: true, purchaseOrder: true },
      orderBy: [{ purchaseOrder: { createdAt: "asc" } }, { lineNumber: "asc" }],
    });
    return rows
      .filter((l) => l.receivedQuantity.greaterThan(l.invoicedQuantity))
      .map((l) => ({
        purchaseOrderLineId: l.id,
        purchaseOrderId: l.purchaseOrderId,
        purchaseOrderNumber: l.purchaseOrder.number,
        itemCode: l.item.code,
        itemName: l.item.name,
        itemNameAr: l.item.nameAr,
        unit: l.item.unit,
        orderPrice: l.unitPrice.toFixed(4),
        invoiceableQuantity: l.receivedQuantity.minus(l.invoicedQuantity).toFixed(4),
      }));
  }

  async preview(input: SupplierInvoiceInput, actor: SupplierInvoiceActor): Promise<InvoicePreview> {
    return this.prisma.$transaction(async (tx) => {
      const evaluation = await this.evaluate(tx, input, actor.companyId, false);
      return evaluation.preview;
    });
  }

  async create(
    input: SupplierInvoiceInput,
    actor: SupplierInvoiceActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SupplierInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const { evaluated, totals, preview } = await this.evaluate(tx, input, actor.companyId, true);

      const blocked = evaluated.find((l) => l.issue !== null);
      if (blocked) {
        throw new SupplierInvoiceError("QTY_EXCEEDS_RECEIVED", "The invoiced quantity is more than has been received and not yet invoiced", blocked.lineNumber);
      }
      if (preview.hasPriceVariance && input.acceptPriceVariance !== true) {
        throw new SupplierInvoiceError("PRICE_VARIANCE_NOT_ACCEPTED", "The invoice price differs from the order price; accept the difference to post");
      }
      if (totals.gross.isZero()) throw new SupplierInvoiceError("ZERO_INVOICE", "An invoice with nothing to pay cannot be posted");

      const duplicate = await tx.supplierInvoice.findFirst({
        where: { companyId: actor.companyId, supplierId: input.supplierId, supplierInvoiceNumber: input.supplierInvoiceNumber.trim() },
        select: { id: true },
      });
      if (duplicate) throw new SupplierInvoiceError("DUPLICATE_INVOICE", "This supplier invoice number was already entered");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.invoiceDate);
      if (!period) throw new SupplierInvoiceError("NO_OPEN_PERIOD", "No open fiscal period covers the invoice date");
      const currency = await companyCurrency(tx, actor.companyId);

      const journalLines: JournalLineInput[] = [];
      if (!totals.grniDebit.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "GRNI"), debit: totals.grniDebit.toFixed(4), description: "Supplier invoice: goods received" });
      }
      if (!totals.priceVariance.isZero()) {
        const accountId = await this.accountMappings.resolve(tx, actor.companyId, "PURCHASE_PRICE_VARIANCE");
        journalLines.push(
          totals.priceVariance.greaterThan(0)
            ? { accountId, debit: totals.priceVariance.toFixed(4), description: "Purchase price variance" }
            : { accountId, credit: totals.priceVariance.negated().toFixed(4), description: "Purchase price variance" },
        );
      }
      for (const l of evaluated) {
        if (l.account && !l.net.isZero()) {
          journalLines.push({ accountId: l.account.id, debit: l.net.toFixed(4), description: l.account.description });
        }
      }
      if (!totals.tax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_INPUT"), debit: totals.tax.toFixed(4), description: "Input VAT" });
      }
      journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_PAYABLE"), credit: totals.gross.toFixed(4), description: "Supplier invoice" });

      const invoiceId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.invoiceDate,
          postingDate: input.invoiceDate,
          currency,
          lines: journalLines,
          sourceModule: "purchasing",
          sourceDocumentType: "supplier_invoice",
          sourceDocumentId: invoiceId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      // The ledger engine numbers its journal entries under the source document type, so the invoice
      // number uses its own series name to stay clear of that sequence.
      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.invoiceDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "supplier_invoice_no", "SI", fiscalYear);
      const orderIds = [...new Set(evaluated.flatMap((l) => (l.poLine ? [l.poLine.purchaseOrderId] : [])))];

      await tx.supplierInvoice.create({
        data: {
          id: invoiceId,
          companyId: actor.companyId,
          documentType: "INVOICE",
          number,
          supplierId: input.supplierId,
          supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate ?? null,
          currency,
          totalNet: totals.net,
          totalTax: totals.tax,
          totalGross: totals.gross,
          purchaseOrderId: orderIds.length === 1 ? (orderIds[0] ?? null) : null,
          journalEntryId: posting.journalEntryId,
          notes: blankToNull(input.notes),
          actorId: actor.id,
          correlationId,
          lines: {
            create: evaluated.map((l) => ({
              id: newId(),
              kind: l.input.kind,
              purchaseOrderLineId: l.poLine?.id ?? null,
              accountId: l.account?.id ?? null,
              description: blankToNull(l.input.description),
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.net,
              taxCodeId: l.taxCode.id,
              taxRate: l.taxCode.rate,
              taxAmount: l.tax,
              priceVariance: l.priceVariance,
              lineNumber: l.lineNumber,
            })),
          },
        },
      });

      // Move each order line's invoiced counter (rows are locked by evaluate).
      const invoicedByLine = new Map<string, Prisma.Decimal>();
      for (const l of evaluated) {
        if (l.poLine) invoicedByLine.set(l.poLine.id, (invoicedByLine.get(l.poLine.id) ?? new Prisma.Decimal(0)).plus(l.quantity));
      }
      for (const [lineId, quantity] of invoicedByLine) {
        await tx.purchaseOrderLine.update({ where: { id: lineId }, data: { invoicedQuantity: { increment: quantity } } });
      }

      return { id: invoiceId, number, journalEntryId: posting.journalEntryId, totalGross: totals.gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "supplier_invoice.posted", entityType: "SupplierInvoice", entityId: result.id, after: { ...result, ...await invoiceAuditSnapshot(this.prisma, actor.companyId, result.id, "supplier") }, correlationId });
    return result;
  }

  // Linked returns reverse original amounts and input VAT. Stock leaves at weighted-average
  // cost, with the invoice/cost difference posted to purchase price variance.
  // Unlinked debit notes remain financial adjustments.
  async createDebitNote(
    input: CreateDebitNoteInput,
    actor: SupplierInvoiceActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SupplierInvoiceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Invoice tables are immutable for the runtime role; serialize returns without UPDATE privileges.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.companyId + ":supplier-return:" + input.originalInvoiceId}, 0))::text`;
      const original = await tx.supplierInvoice.findFirst({ where: { id: input.originalInvoiceId, companyId: actor.companyId }, include: { lines: { include: { returnLines: true, purchaseOrderLine: true } } } });
      if (!original) throw new SupplierInvoiceError("INVOICE_NOT_FOUND", "Invoice not found");
      const previous = await tx.journalEntry.findUnique({ where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey } } });
      if (previous) {
        const note = await tx.supplierInvoice.findFirst({ where: { journalEntryId: previous.id, originalInvoiceId: original.id, companyId: actor.companyId, documentType: "DEBIT_NOTE" } });
        if (!note) throw new SupplierInvoiceError("INVALID_RETURN", "Submission key belongs to a different document");
        return { id: note.id, number: note.number, journalEntryId: previous.id, totalGross: note.totalGross.toFixed(4) };
      }
      if (original.documentType !== "INVOICE") throw new SupplierInvoiceError("NOT_AN_INVOICE", "A debit note can only be raised against an invoice");
      if (input.lines.length === 0) throw new SupplierInvoiceError("EMPTY_INVOICE", "A debit note needs at least one line");

      const taxIds = [...new Set(input.lines.map((l) => l.taxCodeId))];
      const taxCodes = await tx.taxCode.findMany({ where: { id: { in: taxIds }, companyId: actor.companyId, isActive: true } });
      const taxById = new Map(taxCodes.map((t) => [t.id, t]));

      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, companyId: actor.companyId } });
      const accountById = new Map(accounts.map((a) => [a.id, a]));

      const linked = input.lines.some((l) => l.originalLineId !== undefined);
      const seen = new Set<string>();
      const sources = input.lines.map((line) => {
        if (!linked) return null;
        const source = original.lines.find((l) => l.id === line.originalLineId);
        if (!source || seen.has(source.id)) throw new SupplierInvoiceError("INVALID_RETURN", "Choose distinct lines from the original invoice");
        seen.add(source.id);
        const quantity = new Prisma.Decimal(line.quantity);
        const returned = source.returnLines.reduce((sum, l) => sum.plus(l.quantity), new Prisma.Decimal(0));
        if (!quantity.isFinite() || quantity.decimalPlaces() > 4 || !quantity.greaterThan(0) || quantity.plus(returned).greaterThan(source.quantity)) {
          throw new SupplierInvoiceError("OVER_RETURN", "The return quantity exceeds the remaining invoice quantity");
        }
        return { source, quantity, returned, warehouseId: line.warehouseId };
      });
      if (linked && input.debitDate < original.invoiceDate) throw new SupplierInvoiceError("INVALID_RETURN", "Return date cannot precede the invoice");
      const inventoryAccountId = sources.some((l) => l?.source.kind === "PO_LINE")
        ? await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY") : null;
      const evaluated = linked ? sources.map((entry, index) => {
        const { source, quantity, returned } = entry!;
        const accountId = source.kind === "PO_LINE" ? inventoryAccountId : source.accountId;
        if (!accountId) throw new SupplierInvoiceError("ACCOUNT_NOT_FOUND", "Original line has no account");
        return { lineNumber: index + 1, description: source.description ?? "Purchase return", quantity, unitPrice: source.unitPrice,
          taxCode: { id: source.taxCodeId, rate: source.taxRate }, account: { id: accountId },
          net: returnShare(source.netAmount, source.quantity, returned, quantity),
          tax: returnShare(source.taxAmount, source.quantity, returned, quantity) };
      }) : input.lines.map((line, index) => {
        const lineNumber = index + 1;
        const taxCode = taxById.get(line.taxCodeId);
        if (!taxCode) throw new SupplierInvoiceError("TAX_CODE_NOT_FOUND", "A tax code on the debit note was not found or is inactive", lineNumber);
        const account = accountById.get(line.accountId);
        if (!account) throw new SupplierInvoiceError("ACCOUNT_NOT_FOUND", "An expense account on the debit note was not found", lineNumber);
        if (!account.isPostable) throw new SupplierInvoiceError("ACCOUNT_NOT_POSTABLE", "An expense account on the debit note is a group, not a postable account", lineNumber);
        const description = line.description.trim();
        if (!description) throw new SupplierInvoiceError("EMPTY_INVOICE", "A debit note line needs a description", lineNumber);
        const quantity = new Prisma.Decimal(line.quantity);
        const unitPrice = new Prisma.Decimal(line.unitPrice);
        const math = expenseLineMath(quantity, unitPrice, taxCode.rate);
        return { lineNumber, description, quantity, unitPrice, taxCode, account, net: math.net, tax: math.tax };
      });

      const totalNet = evaluated.reduce((sum, l) => sum.plus(l.net), new Prisma.Decimal(0));
      const totalTax = evaluated.reduce((sum, l) => sum.plus(l.tax), new Prisma.Decimal(0));
      const gross = totalNet.plus(totalTax);
      if (gross.isZero()) throw new SupplierInvoiceError("ZERO_INVOICE", "A debit note with nothing to debit cannot be posted");

      // Debit notes already raised against this invoice, plus this one, never exceed the invoice.
      const debited = await tx.supplierInvoice.aggregate({
        where: { companyId: actor.companyId, originalInvoiceId: original.id },
        _sum: { totalGross: true },
      });
      const already = debited._sum.totalGross ?? new Prisma.Decimal(0);
      if (already.plus(gross).greaterThan(original.totalGross)) {
        throw new SupplierInvoiceError("DEBIT_EXCEEDS_INVOICE", "The debit notes would be worth more than the invoice");
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.debitDate);
      if (!period) throw new SupplierInvoiceError("NO_OPEN_PERIOD", "No open fiscal period covers the debit note date");
      const currency = linked ? original.currency : await companyCurrency(tx, actor.companyId);

      const journalLines: JournalLineInput[] = [
        { accountId: await this.accountMappings.resolve(tx, actor.companyId, "ACCOUNTS_PAYABLE"), debit: gross.toFixed(4), description: "Debit note" },
      ];
      const stockReturns: { itemId: string; warehouseId: string; quantity: Prisma.Decimal; value: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
      const stockValues = new Map<string, Prisma.Decimal>();
      const ordered = sources.filter((entry) => entry?.source.kind === "PO_LINE")
        .sort((a, b) => (a!.source.purchaseOrderLine!.itemId + a!.warehouseId).localeCompare(b!.source.purchaseOrderLine!.itemId + b!.warehouseId));
      for (const entry of ordered) {
        const { source, quantity, warehouseId } = entry!;
        const warehouse = warehouseId ? await tx.warehouse.findFirst({ where: { id: warehouseId, companyId: actor.companyId, isActive: true } }) : null;
        if (!warehouse) throw new SupplierInvoiceError("WAREHOUSE_NOT_FOUND", "Choose an active return warehouse");
        const itemId = source.purchaseOrderLine!.itemId;
        const stock = await lockStockRow(tx, actor.companyId, itemId, warehouse.id);
        let issued;
        try { issued = applyIssue(stock.state, quantity); }
        catch (error) {
          if (error instanceof InsufficientStockError) throw new SupplierInvoiceError("INSUFFICIENT_STOCK", error.message);
          throw error;
        }
        await saveStockRow(tx, stock.id, issued.state);
        stockValues.set(source.id, issued.value);
        stockReturns.push({ itemId, warehouseId: warehouse.id, quantity, value: issued.value, unitCost: issued.unitCost });
      }
      let variance = new Prisma.Decimal(0);
      const netByAccount = new Map<string, Prisma.Decimal>();
      for (const l of evaluated) {
        const source = sources[l.lineNumber - 1]?.source;
        const stockValue = source ? stockValues.get(source.id) : undefined;
        const amount = stockValue ?? l.net;
        if (stockValue !== undefined) variance = variance.plus(l.net.minus(stockValue));
        netByAccount.set(l.account.id, (netByAccount.get(l.account.id) ?? new Prisma.Decimal(0)).plus(amount));
      }
      for (const [accountId, amount] of netByAccount) {
        if (!amount.isZero()) journalLines.push({ accountId, credit: amount.toFixed(4), description: "Debit note: expense reversed" });
      }
      if (!variance.isZero()) {
        const accountId = await this.accountMappings.resolve(tx, actor.companyId, "PURCHASE_PRICE_VARIANCE");
        journalLines.push(variance.greaterThan(0)
          ? { accountId, credit: variance.toFixed(4), description: "Purchase return: cost difference" }
          : { accountId, debit: variance.abs().toFixed(4), description: "Purchase return: cost difference" });
      }
      if (!totalTax.isZero()) {
        journalLines.push({ accountId: await this.accountMappings.resolve(tx, actor.companyId, "VAT_INPUT"), credit: totalTax.toFixed(4), description: "Debit note: input VAT" });
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
          sourceModule: "purchasing",
          sourceDocumentType: "supplier_debit_note",
          sourceDocumentId: noteId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.debitDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "supplier_debit_note_no", "DN", fiscalYear);

      await tx.supplierInvoice.create({
        data: {
          id: noteId,
          companyId: actor.companyId,
          documentType: "DEBIT_NOTE",
          number,
          supplierId: original.supplierId,
          supplierInvoiceNumber: null,
          originalInvoiceId: original.id,
          invoiceDate: input.debitDate,
          dueDate: null,
          currency,
          totalNet,
          totalTax,
          totalGross: gross,
          journalEntryId: posting.journalEntryId,
          notes: blankToNull(input.notes),
          actorId: actor.id,
          correlationId,
          lines: {
            create: evaluated.map((l) => ({
              id: newId(),
              originalLineId: sources[l.lineNumber - 1]?.source.id ?? null,
              kind: sources[l.lineNumber - 1]?.source.kind ?? "EXPENSE",
              purchaseOrderLineId: sources[l.lineNumber - 1]?.source.purchaseOrderLineId ?? null,
              accountId: sources[l.lineNumber - 1]?.source.kind === "PO_LINE" ? null : l.account.id,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.net,
              taxCodeId: l.taxCode.id,
              taxRate: l.taxCode.rate,
              taxAmount: l.tax,
              priceVariance: new Prisma.Decimal(0),
              lineNumber: l.lineNumber,
            })),
          },
        },
      });

      if (stockReturns.length) await tx.stockMovement.createMany({ data: stockReturns.map((l) => ({
        id: newId(), companyId: actor.companyId, itemId: l.itemId, warehouseId: l.warehouseId,
        movementType: "RETURN", quantity: l.quantity.negated(), unitCost: l.unitCost, value: l.value,
        sourceDocumentType: "supplier_debit_note", sourceDocumentId: noteId,
        journalEntryId: posting.journalEntryId, actorId: actor.id, correlationId,
      })) });
      // Invoiced/received PO counters remain historical: a return cannot make invoiced
      // units eligible for a second unbilled goods return or a second supplier invoice.
      return { id: noteId, number, journalEntryId: posting.journalEntryId, totalGross: gross.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "supplier_debit_note.posted", entityType: "SupplierInvoice", entityId: result.id, after: { ...result, ...await invoiceAuditSnapshot(this.prisma, actor.companyId, result.id, "supplier") }, correlationId });
    return result;
  }

  async list(companyId: string, query: SupplierInvoiceListQuery): Promise<SupplierInvoiceListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.supplierInvoice.findMany({
      where: {
        companyId,
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
      },
      include: { supplier: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((r) => ({
        id: r.id,
        documentType: r.documentType as "INVOICE" | "DEBIT_NOTE",
        number: r.number,
        supplierInvoiceNumber: r.supplierInvoiceNumber,
        supplierId: r.supplierId,
        supplierName: r.supplier.name,
        supplierNameAr: r.supplier.nameAr,
        originalInvoiceId: r.originalInvoiceId,
        invoiceDate: dateOnly(r.invoiceDate),
        dueDate: r.dueDate ? dateOnly(r.dueDate) : null,
        currency: r.currency,
        totalNet: r.totalNet.toFixed(4),
        totalTax: r.totalTax.toFixed(4),
        totalGross: r.totalGross.toFixed(4),
      })),
      pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null },
    };
  }

  async get(id: string, companyId: string): Promise<SupplierInvoiceDetail | null> {
    const r = await this.prisma.supplierInvoice.findFirst({
      where: { id, companyId },
      include: {
        supplier: true,
        purchaseOrder: { select: { number: true } },
        originalInvoice: { select: { number: true } },
        debitNotes: { select: { id: true, number: true, totalGross: true }, orderBy: { createdAt: "asc" } },
        paymentAllocations: { include: { payment: { select: { id: true, number: true, paymentDate: true } } } },
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { returnLines: true, account: { select: { code: true, name: true, nameAr: true } }, taxCode: { select: { code: true } }, purchaseOrderLine: { include: { item: { select: { code: true, name: true, nameAr: true } } } } },
        },
      },
    });
    if (!r) return null;
    const outstanding = r.documentType === "INVOICE" ? ((await loadOutstanding(this.prisma, companyId, "SUPPLIER", { ids: [id] }))[0]?.outstanding ?? null) : null;
    return {
      id: r.id,
      documentType: r.documentType as "INVOICE" | "DEBIT_NOTE",
      number: r.number,
      supplierInvoiceNumber: r.supplierInvoiceNumber,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      supplierNameAr: r.supplier.nameAr,
      originalInvoiceId: r.originalInvoiceId,
      invoiceDate: dateOnly(r.invoiceDate),
      dueDate: r.dueDate ? dateOnly(r.dueDate) : null,
      currency: r.currency,
      totalNet: r.totalNet.toFixed(4),
      totalTax: r.totalTax.toFixed(4),
      totalGross: r.totalGross.toFixed(4),
      notes: r.notes,
      purchaseOrderId: r.purchaseOrderId,
      purchaseOrderNumber: r.purchaseOrder?.number ?? null,
      originalInvoiceNumber: r.originalInvoice?.number ?? null,
      journalEntryId: r.journalEntryId,
      lines: r.lines.map((l) => ({
        id: l.id,
        taxCodeId: l.taxCodeId,
        originalLineId: l.originalLineId,
        returnableQuantity: l.quantity.minus(l.returnLines.reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0))).toFixed(4),
        lineNumber: l.lineNumber,
        kind: l.kind as "PO_LINE" | "EXPENSE",
        itemCode: l.purchaseOrderLine?.item.code ?? null,
        itemName: l.purchaseOrderLine?.item.name ?? null,
        itemNameAr: l.purchaseOrderLine?.item.nameAr ?? null,
        accountCode: l.account?.code ?? null,
        accountName: l.account?.name ?? null,
        accountNameAr: l.account?.nameAr ?? null,
        description: l.description,
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        netAmount: l.netAmount.toFixed(4),
        taxCode: l.taxCode.code,
        taxRate: l.taxRate.toFixed(4),
        taxAmount: l.taxAmount.toFixed(4),
        priceVariance: l.priceVariance.toFixed(4),
      })),
      payments: r.paymentAllocations.map((a) => ({ paymentId: a.payment.id, number: a.payment.number, paymentDate: dateOnly(a.payment.paymentDate), amount: a.amount.toFixed(4) })),
      debitNotes: r.debitNotes.map((d) => ({ id: d.id, number: d.number, totalGross: d.totalGross.toFixed(4) })),
      outstanding: outstanding ? outstanding.toFixed(4) : null,
    };
  }

  // Looks everything up (and, when `lock`, row-locks the order lines it will move) and does the
  // arithmetic; neither posts nor writes. Shared by preview and create so the two cannot disagree.
  private async evaluate(tx: TransactionClient, input: SupplierInvoiceInput, companyId: string, lock: boolean) {
    if (input.lines.length === 0) throw new SupplierInvoiceError("EMPTY_INVOICE", "An invoice needs at least one line");

    const supplier = await tx.party.findFirst({ where: { id: input.supplierId, companyId, isActive: true }, select: { id: true } });
    if (!supplier) throw new SupplierInvoiceError("SUPPLIER_NOT_FOUND", "Supplier not found");

    const poLineIds = [...new Set(input.lines.flatMap((l) => (l.kind === "PO_LINE" && l.purchaseOrderLineId ? [l.purchaseOrderLineId] : [])))];
    if (lock && poLineIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE id = ANY(${poLineIds}::text[]) ORDER BY id FOR UPDATE`;
    }
    const poLines = await tx.purchaseOrderLine.findMany({ where: { id: { in: poLineIds } }, include: { purchaseOrder: true, item: true } });
    const poLineById = new Map(poLines.map((l) => [l.id, l]));

    const taxIds = [...new Set(input.lines.map((l) => l.taxCodeId))];
    const taxCodes = await tx.taxCode.findMany({ where: { id: { in: taxIds }, companyId, isActive: true } });
    const taxById = new Map(taxCodes.map((t) => [t.id, t]));

    const accountIds = [...new Set(input.lines.flatMap((l) => (l.kind === "EXPENSE" && l.accountId ? [l.accountId] : [])))];
    const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, companyId } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    // The same order line may appear on two invoice lines; the bound applies to the running sum.
    const claimed = new Map<string, Prisma.Decimal>();
    const evaluated: EvaluatedLine[] = input.lines.map((line, index) => {
      const lineNumber = index + 1;
      const taxCode = taxById.get(line.taxCodeId);
      if (!taxCode) throw new SupplierInvoiceError("TAX_CODE_NOT_FOUND", "A tax code on the invoice was not found or is inactive", lineNumber);
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const taxRef = { id: taxCode.id, rate: taxCode.rate };

      if (line.kind === "PO_LINE") {
        const poLine = line.purchaseOrderLineId ? poLineById.get(line.purchaseOrderLineId) : undefined;
        if (!poLine || poLine.purchaseOrder.companyId !== companyId) throw new SupplierInvoiceError("PO_LINE_NOT_FOUND", "An order line on the invoice was not found", lineNumber);
        if (poLine.purchaseOrder.supplierId !== input.supplierId) throw new SupplierInvoiceError("SUPPLIER_MISMATCH", "An order line belongs to a different supplier", lineNumber);

        const invoiceable = poLine.receivedQuantity.minus(poLine.invoicedQuantity).minus(claimed.get(poLine.id) ?? 0);
        claimed.set(poLine.id, (claimed.get(poLine.id) ?? new Prisma.Decimal(0)).plus(quantity));
        const math = poLineMath(quantity, unitPrice, poLine.unitPrice, taxCode.rate);
        return {
          input: line,
          lineNumber,
          quantity,
          unitPrice,
          taxCode: taxRef,
          net: math.net,
          tax: math.tax,
          priceVariance: math.priceVariance,
          po: math,
          poLine: { id: poLine.id, purchaseOrderId: poLine.purchaseOrderId, invoiceable, orderPrice: poLine.unitPrice, description: `${poLine.item.code} ${poLine.item.name}` },
          account: null,
          issue: quantity.greaterThan(invoiceable) ? "QTY_EXCEEDS_RECEIVED" : null,
        };
      }

      const account = line.accountId ? accountById.get(line.accountId) : undefined;
      if (!account) throw new SupplierInvoiceError("ACCOUNT_NOT_FOUND", "An expense account on the invoice was not found", lineNumber);
      if (!account.isPostable) throw new SupplierInvoiceError("ACCOUNT_NOT_POSTABLE", "An expense account on the invoice is a group, not a postable account", lineNumber);
      const math = expenseLineMath(quantity, unitPrice, taxCode.rate);
      return {
        input: line,
        lineNumber,
        quantity,
        unitPrice,
        taxCode: taxRef,
        net: math.net,
        tax: math.tax,
        priceVariance: new Prisma.Decimal(0),
        po: null,
        poLine: null,
        account: { id: account.id, description: line.description?.trim() || `${account.code} ${account.name}` },
        issue: null,
      };
    });

    const totals = invoiceTotals(
      evaluated.flatMap((l) => (l.po ? [l.po] : [])),
      evaluated.filter((l) => l.po === null),
    );

    const preview: InvoicePreview = {
      lines: evaluated.map((l) => ({
        lineNumber: l.lineNumber,
        kind: l.input.kind,
        description: l.poLine?.description ?? l.account?.description ?? "",
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        orderPrice: l.poLine ? l.poLine.orderPrice.toFixed(4) : null,
        net: l.net.toFixed(4),
        taxRate: l.taxCode.rate.toFixed(4),
        tax: l.tax.toFixed(4),
        priceVariance: l.priceVariance.toFixed(4),
        invoiceableQuantity: l.poLine ? l.poLine.invoiceable.toFixed(4) : null,
        issue: l.issue,
      })),
      totalNet: totals.net.toFixed(4),
      totalTax: totals.tax.toFixed(4),
      totalGross: totals.gross.toFixed(4),
      totalPriceVariance: totals.priceVariance.toFixed(4),
      hasPriceVariance: evaluated.some((l) => !l.priceVariance.isZero()),
      canPost: evaluated.every((l) => l.issue === null),
    };
    return { evaluated, totals, preview };
  }
}
