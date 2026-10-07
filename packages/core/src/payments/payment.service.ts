import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { loadOutstanding, type InvoiceSide, type OutstandingInvoice } from "./outstanding.js";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentDirection = "RECEIPT" | "PAYMENT";

export class PaymentError extends Error {
  constructor(
    readonly code:
      | "PARTY_NOT_FOUND"
      | "CASH_ACCOUNT_NOT_FOUND"
      | "CASH_ACCOUNT_INVALID"
      | "INVOICE_NOT_FOUND"
      | "OVER_ALLOCATED"
      | "ALLOCATION_EXCEEDS_PAYMENT"
      | "DUPLICATE_ALLOCATION"
      | "NO_OPEN_PERIOD"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PaymentAllocationInput {
  readonly invoiceId: string;
  readonly amount: string;
}

export interface CreatePaymentInput {
  readonly direction: PaymentDirection;
  readonly partyId: string;
  readonly paymentDate: Date;
  readonly amount: string;
  readonly cashAccountId: string;
  readonly method: PaymentMethod;
  readonly reference?: string | undefined;
  readonly notes?: string | undefined;
  readonly allocations: readonly PaymentAllocationInput[];
}

export interface PaymentActor {
  readonly id: string;
  readonly companyId: string;
}

export interface PaymentResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly unallocated: string;
}

export interface PaymentSummary {
  readonly id: string;
  readonly direction: PaymentDirection;
  readonly number: string;
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly paymentDate: string;
  readonly amount: string;
  readonly allocated: string;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
}

export interface PaymentListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly direction?: PaymentDirection | undefined;
  readonly partyId?: string | undefined;
}

export interface PaymentListPage {
  readonly data: readonly PaymentSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface OpenInvoiceView {
  readonly id: string;
  readonly number: string;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly gross: string;
  readonly outstanding: string;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);
const sideOf = (direction: PaymentDirection): InvoiceSide => (direction === "RECEIPT" ? "SALES" : "SUPPLIER");

// A customer receipt or a supplier payment.
//   RECEIPT : Dr bank/cash, Cr accounts receivable        (the full amount)
//   PAYMENT : Dr accounts payable, Cr bank/cash           (the full amount)
// The allocations name the invoices it settles and may total less than the amount: the rest stays
// on account for the party. An invoice can never be allocated more than it still owes. Posted
// documents are insert-only, so the party's row (which the runtime role may update) is locked to
// serialize two payments for the same party racing for the same invoice.
export class PaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreatePaymentInput, actor: PaymentActor, correlationId: string, idempotencyKey: string): Promise<PaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM parties WHERE id = ${input.partyId} AND company_id = ${actor.companyId} AND is_active = true FOR UPDATE
      `;
      if (locked.length === 0) throw new PaymentError("PARTY_NOT_FOUND", "Party not found");

      const amount = new Prisma.Decimal(input.amount);
      const cash = await tx.account.findFirst({ where: { id: input.cashAccountId, companyId: actor.companyId } });
      if (!cash) throw new PaymentError("CASH_ACCOUNT_NOT_FOUND", "The bank or cash account was not found");
      if (!cash.isPostable || cash.type !== "ASSET") throw new PaymentError("CASH_ACCOUNT_INVALID", "Choose a postable asset account for the bank or cash");

      // ── allocations: each invoice is the party's, and owes at least what is allocated to it ──
      const ids = input.allocations.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length) throw new PaymentError("DUPLICATE_ALLOCATION", "An invoice appears twice in the allocations");
      const side = sideOf(input.direction);
      const open = new Map((await loadOutstanding(tx, actor.companyId, side, { ids, partyId: input.partyId })).map((o) => [o.id, o]));
      let allocated = new Prisma.Decimal(0);
      for (const allocation of input.allocations) {
        const invoice = open.get(allocation.invoiceId);
        if (!invoice) throw new PaymentError("INVOICE_NOT_FOUND", "An invoice to settle was not found for this party");
        const value = new Prisma.Decimal(allocation.amount);
        if (value.greaterThan(invoice.outstanding)) throw new PaymentError("OVER_ALLOCATED", "More than that invoice still owes");
        allocated = allocated.plus(value);
      }
      if (allocated.greaterThan(amount)) throw new PaymentError("ALLOCATION_EXCEEDS_PAYMENT", "The allocations add up to more than the payment");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.paymentDate);
      if (!period) throw new PaymentError("NO_OPEN_PERIOD", "No open fiscal period covers the payment date");
      const currency = await companyCurrency(tx, actor.companyId);

      const controlKey = input.direction === "RECEIPT" ? "ACCOUNTS_RECEIVABLE" : "ACCOUNTS_PAYABLE";
      const controlId = await this.accountMappings.resolve(tx, actor.companyId, controlKey);
      const journalLines: JournalLineInput[] =
        input.direction === "RECEIPT"
          ? [
              { accountId: cash.id, debit: amount.toFixed(4), description: "Customer receipt" },
              { accountId: controlId, credit: amount.toFixed(4), description: "Customer receipt" },
            ]
          : [
              { accountId: controlId, debit: amount.toFixed(4), description: "Supplier payment" },
              { accountId: cash.id, credit: amount.toFixed(4), description: "Supplier payment" },
            ];

      const paymentId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.paymentDate,
          postingDate: input.paymentDate,
          currency,
          lines: journalLines,
          sourceModule: "payments",
          sourceDocumentType: input.direction === "RECEIPT" ? "customer_receipt" : "supplier_payment",
          sourceDocumentId: paymentId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.paymentDate);
      const number =
        input.direction === "RECEIPT"
          ? await allocateDocumentNumber(tx, actor.companyId, "payment_receipt_no", "RCT", fiscalYear)
          : await allocateDocumentNumber(tx, actor.companyId, "payment_out_no", "PAY", fiscalYear);

      await tx.payment.create({
        data: {
          id: paymentId,
          companyId: actor.companyId,
          direction: input.direction,
          number,
          partyId: input.partyId,
          paymentDate: input.paymentDate,
          amount,
          currency,
          cashAccountId: cash.id,
          method: input.method,
          reference: blankToNull(input.reference),
          notes: blankToNull(input.notes),
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
          allocations: {
            create: input.allocations.map((a) => ({
              id: newId(),
              companyId: actor.companyId,
              amount: new Prisma.Decimal(a.amount),
              ...(side === "SALES" ? { salesInvoiceId: a.invoiceId } : { supplierInvoiceId: a.invoiceId }),
            })),
          },
        },
      });

      return { id: paymentId, number, journalEntryId: posting.journalEntryId, unallocated: amount.minus(allocated).toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: input.direction === "RECEIPT" ? "customer_receipt.posted" : "supplier_payment.posted", entityType: "Payment", entityId: result.id, after: { ...result }, correlationId });
    return result;
  }

  async list(companyId: string, query: PaymentListQuery): Promise<PaymentListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.payment.findMany({
      where: { companyId, ...(query.direction ? { direction: query.direction } : {}), ...(query.partyId ? { partyId: query.partyId } : {}) },
      include: { party: true, allocations: { select: { amount: true } } },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((p) => ({
        id: p.id,
        direction: p.direction as PaymentDirection,
        number: p.number,
        partyId: p.partyId,
        partyName: p.party.name,
        partyNameAr: p.party.nameAr,
        paymentDate: dateOnly(p.paymentDate),
        amount: p.amount.toFixed(4),
        allocated: p.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)).toFixed(4),
        currency: p.currency,
        method: p.method as PaymentMethod,
        reference: p.reference,
      })),
      pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null },
    };
  }

  // The party's invoices that still owe something — what a payment can be allocated to.
  async openInvoices(companyId: string, partyId: string, direction: PaymentDirection): Promise<OpenInvoiceView[]> {
    const open: OutstandingInvoice[] = await loadOutstanding(this.prisma, companyId, sideOf(direction), { partyId });
    return open
      .filter((o) => o.outstanding.greaterThan(0))
      .map((o) => ({
        id: o.id,
        number: o.number,
        invoiceDate: o.invoiceDate,
        dueDate: o.dueDate,
        currency: o.currency,
        gross: o.gross.toFixed(4),
        outstanding: o.outstanding.toFixed(4),
      }));
  }
}
