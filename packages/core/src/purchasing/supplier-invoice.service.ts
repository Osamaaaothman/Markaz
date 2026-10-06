import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { expenseLineMath, invoiceTotals, poLineMath, type PoLineMath } from "./supplier-invoice.util.js";

export type SupplierInvoiceErrorCode =
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
  | "INVOICE_NOT_FOUND";

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

export interface SupplierInvoiceSummary {
  readonly id: string;
  readonly number: string;
  readonly supplierInvoiceNumber: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SupplierInvoiceListPage {
  readonly data: readonly SupplierInvoiceSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface SupplierInvoiceListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly supplierId?: string | undefined;
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

    await this.audit.log({ actorId: actor.id, action: "supplier_invoice.posted", entityType: "SupplierInvoice", entityId: result.id, after: { ...result }, correlationId });
    return result;
  }

  async list(companyId: string, query: SupplierInvoiceListQuery): Promise<SupplierInvoiceListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.supplierInvoice.findMany({
      where: { companyId, ...(query.supplierId ? { supplierId: query.supplierId } : {}) },
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
        number: r.number,
        supplierInvoiceNumber: r.supplierInvoiceNumber,
        supplierId: r.supplierId,
        supplierName: r.supplier.name,
        supplierNameAr: r.supplier.nameAr,
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
