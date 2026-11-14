import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { loadOutstanding, type InvoiceSide, type OutstandingInvoice } from "./outstanding.js";
import { paymentCashAccounts } from "./payment-accounts.js";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentDirection = "RECEIPT" | "PAYMENT";
export const PAYMENT_COUNTERPARTY_KINDS = ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "ACCOUNT"] as const;
export type PaymentCounterpartyKind = (typeof PAYMENT_COUNTERPARTY_KINDS)[number];

export class PaymentError extends Error {
  constructor(
    readonly code:
      | "PARTY_NOT_FOUND"
      | "PARTY_KIND_INVALID"
      | "COUNTER_ACCOUNT_INVALID"
      | "ALLOCATION_NOT_ALLOWED"
      | "CASH_ACCOUNT_NOT_FOUND"
      | "CASH_ACCOUNT_INVALID"
      | "INVOICE_NOT_FOUND"
      | "OVER_ALLOCATED"
      | "ALLOCATION_EXCEEDS_PAYMENT"
      | "DUPLICATE_ALLOCATION"
      | "NO_OPEN_PERIOD"
      | "NOT_FOUND"
      | "ALREADY_VOIDED"
      | "INSUFFICIENT_BALANCE",
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
  readonly partyId?: string | undefined;
  readonly counterpartyKind?: PaymentCounterpartyKind | undefined;
  readonly counterAccountId?: string | undefined;
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
  readonly partyId: string | null;
  readonly counterpartyKind: PaymentCounterpartyKind;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly paymentDate: string;
  readonly amount: string;
  readonly allocated: string;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
}

// One invoice a payment was set against, and how much of the payment went to it.
export interface PaymentAllocationView {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  // Which side the invoice is on: a receipt settles sales invoices, a payment settles supplier invoices.
  readonly invoiceKind: "SALES" | "SUPPLIER";
  readonly amount: string;
}

export interface PaymentDetail extends PaymentSummary {
  readonly counterAccountId: string | null;
  readonly counterAccountCode: string | null;
  readonly counterAccountName: string | null;
  readonly counterAccountNameAr: string | null;
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly notes: string | null;
  readonly journalEntryId: string;
  readonly allocations: readonly PaymentAllocationView[];
  // What was not set against any invoice: it stays on account for the party.
  readonly unallocated: string;
  readonly voidedAt: string | null;
  readonly reversesPaymentId: string | null;
  readonly reversedByPaymentId: string | null;
}

export interface ReversePaymentInput {
  readonly paymentId: string;
  readonly reversalDate: Date;
  readonly notes?: string | undefined;
}

export interface ReversePaymentResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
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

// One of the party's payments that still has money not set against any invoice.
export interface UnallocatedPaymentView {
  readonly id: string;
  readonly number: string;
  readonly paymentDate: string;
  readonly method: PaymentMethod;
  readonly unallocated: string;
}

export interface PartyBalanceView {
  readonly totalUnallocated: string;
  readonly unallocatedPayments: readonly UnallocatedPaymentView[];
  readonly openInvoices: readonly OpenInvoiceView[];
}

export interface SettleAllocationInput {
  readonly invoiceId: string;
  readonly amount: string;
}

export interface SettleInput {
  readonly partyId: string;
  readonly direction: PaymentDirection;
  readonly allocations: readonly SettleAllocationInput[];
}

export interface SettleResult {
  readonly totalAllocated: string;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);
const sideOf = (direction: PaymentDirection): InvoiceSide => (direction === "RECEIPT" ? "SALES" : "SUPPLIER");

// Receipts debit bank/cash and credit the counter-account; payments do the reverse.
// Customer/supplier roles use the same control accounts as their invoices. Employee/account
// vouchers use the selected postable account and cannot allocate invoices.
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

  cashAccounts(companyId: string, method: PaymentMethod) {
    return paymentCashAccounts(this.prisma, companyId, method);
  }

  async create(input: CreatePaymentInput, actor: PaymentActor, correlationId: string, idempotencyKey: string): Promise<PaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const counterpartyKind = input.counterpartyKind ?? (input.direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER");
      if (counterpartyKind === "ACCOUNT") {
        if (input.partyId) throw new PaymentError("PARTY_KIND_INVALID", "Choose an account without a party");
      } else {
        const locked = await tx.$queryRaw<{ id: string; kind: string }[]>`
          SELECT id, kind FROM parties WHERE id = ${input.partyId ?? ""} AND company_id = ${actor.companyId} AND is_active = true FOR UPDATE
        `;
        const party = locked[0];
        if (!party) throw new PaymentError("PARTY_NOT_FOUND", "Party not found");
        const dual = party.kind === "CUSTOMER_SUPPLIER" && (counterpartyKind === "CUSTOMER" || counterpartyKind === "SUPPLIER");
        // Old API clients may still use historical COMPANY/PERSON parties. Explicit role selections are strict.
        const legacyParty = !input.counterpartyKind && ["COMPANY", "PERSON", "OTHER"].includes(party.kind);
        if (party.kind !== counterpartyKind && !dual && !legacyParty) throw new PaymentError("PARTY_KIND_INVALID", "The party does not match the selected type");
      }

      const amount = new Prisma.Decimal(input.amount);
      const cash = await tx.account.findFirst({ where: { id: input.cashAccountId, companyId: actor.companyId } });
      if (!cash) throw new PaymentError("CASH_ACCOUNT_NOT_FOUND", "The bank or cash account was not found");
      if (!(await paymentCashAccounts(tx, actor.companyId, input.method)).some((a) => a.id === cash.id)) {
        throw new PaymentError("CASH_ACCOUNT_INVALID", "Choose an active cash account for cash, or a bank account for other methods");
      }

      const canAllocate = (counterpartyKind === "CUSTOMER" && input.direction === "RECEIPT") || (counterpartyKind === "SUPPLIER" && input.direction === "PAYMENT");
      if (!canAllocate && input.allocations.length > 0) throw new PaymentError("ALLOCATION_NOT_ALLOWED", "This voucher type cannot settle invoices");
      let controlId: string;
      if (counterpartyKind === "CUSTOMER" || counterpartyKind === "SUPPLIER") {
        // Match the control account used by invoices; direction determines debit/credit, not the party's role.
        controlId = await this.accountMappings.resolve(tx, actor.companyId, counterpartyKind === "CUSTOMER" ? "ACCOUNTS_RECEIVABLE" : "ACCOUNTS_PAYABLE");
        if (input.counterAccountId && input.counterAccountId !== controlId) throw new PaymentError("COUNTER_ACCOUNT_INVALID", "The party control account cannot be overridden");
      } else {
        const counter = await tx.account.findFirst({ where: { id: input.counterAccountId ?? "", companyId: actor.companyId, isActive: true, isPostable: true } });
        if (!counter || (counterpartyKind === "EMPLOYEE" && counter.partyId !== input.partyId)) throw new PaymentError("COUNTER_ACCOUNT_INVALID", "Choose an active postable account for the selected party");
        controlId = counter.id;
      }
      if (controlId === cash.id) throw new PaymentError("COUNTER_ACCOUNT_INVALID", "The two accounts must be different");

      // ── allocations: each invoice is the party's, and owes at least what is allocated to it ──
      const ids = input.allocations.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length) throw new PaymentError("DUPLICATE_ALLOCATION", "An invoice appears twice in the allocations");
      const side = sideOf(input.direction);
      const open = new Map((input.partyId && ids.length ? await loadOutstanding(tx, actor.companyId, side, { ids, partyId: input.partyId }) : []).map((o) => [o.id, o]));
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

      const journalLines: JournalLineInput[] =
        input.direction === "RECEIPT"
          ? [
              { accountId: cash.id, debit: amount.toFixed(4), description: "Receipt voucher" },
              { accountId: controlId, credit: amount.toFixed(4), description: "Receipt voucher" },
            ]
          : [
              { accountId: controlId, debit: amount.toFixed(4), description: "Payment voucher" },
              { accountId: cash.id, credit: amount.toFixed(4), description: "Payment voucher" },
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
          partyId: input.partyId ?? null,
          counterpartyKind,
          counterAccountId: controlId,
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

  async get(id: string, companyId: string): Promise<PaymentDetail | null> {
    const p = await this.prisma.payment.findFirst({
      where: { id, companyId },
      include: {
        party: true,
        counterAccount: { select: { code: true, name: true, nameAr: true } },
        cashAccount: { select: { code: true, name: true, nameAr: true } },
        allocations: { include: { salesInvoice: { select: { id: true, number: true } }, supplierInvoice: { select: { id: true, number: true } } } },
      },
    });
    if (!p) return null;
    const allocated = p.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
    return {
      id: p.id,
      direction: p.direction as PaymentDirection,
      number: p.number,
      partyId: p.partyId,
      counterpartyKind: (p.counterpartyKind ?? (p.direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER")) as PaymentCounterpartyKind,
      partyName: p.party?.name ?? p.counterAccount?.name ?? "",
      partyNameAr: p.party ? p.party.nameAr : p.counterAccount?.nameAr ?? null,
      counterAccountId: p.counterAccountId,
      counterAccountCode: p.counterAccount?.code ?? null,
      counterAccountName: p.counterAccount?.name ?? null,
      counterAccountNameAr: p.counterAccount?.nameAr ?? null,
      paymentDate: dateOnly(p.paymentDate),
      amount: p.amount.toFixed(4),
      allocated: allocated.toFixed(4),
      currency: p.currency,
      method: p.method as PaymentMethod,
      reference: p.reference,
      cashAccountCode: p.cashAccount.code,
      cashAccountName: p.cashAccount.name,
      cashAccountNameAr: p.cashAccount.nameAr,
      notes: p.notes,
      journalEntryId: p.journalEntryId,
      allocations: p.allocations.flatMap((a) => {
        const invoice = a.salesInvoice ?? a.supplierInvoice;
        return invoice ? [{ invoiceId: invoice.id, invoiceNumber: invoice.number, invoiceKind: a.salesInvoice ? ("SALES" as const) : ("SUPPLIER" as const), amount: a.amount.toFixed(4) }] : [];
      }),
      unallocated: p.amount.minus(allocated).toFixed(4),
      voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
      reversesPaymentId: p.reversesPaymentId,
      reversedByPaymentId: p.reversedByPaymentId,
    };
  }

  // Reverse a posted payment: post a counter journal entry, remove the allocations (restoring
  // invoice outstanding), mark the original voided, and create a new reversal payment record.
  async reverse(input: ReversePaymentInput, actor: PaymentActor, correlationId: string, idempotencyKey: string): Promise<ReversePaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${input.paymentId} AND company_id = ${actor.companyId} FOR UPDATE`;
      const original = await tx.payment.findFirst({ where: { id: input.paymentId, companyId: actor.companyId }, include: { allocations: true, journalEntry: { include: { lines: true } } } });
      if (!original) throw new PaymentError("NOT_FOUND", "Payment not found");
      if (original.voidedAt !== null || original.reversesPaymentId !== null) throw new PaymentError("ALREADY_VOIDED", "This payment has already been reversed");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.reversalDate);
      if (!period) throw new PaymentError("NO_OPEN_PERIOD", "No open fiscal period covers the reversal date");
      const currency = await companyCurrency(tx, actor.companyId);

      const amount = original.amount;

      // Counter-entry: flip the original journal lines
      const journalLines: JournalLineInput[] = original.journalEntry.lines.map((line) => ({
        accountId: line.accountId,
        ...(line.credit.greaterThan(0) ? { debit: line.credit.toFixed(4) } : { credit: line.debit.toFixed(4) }),
        description: "Payment reversal",
      }));

      const reversalId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.reversalDate,
          postingDate: input.reversalDate,
          currency,
          lines: journalLines,
          sourceModule: "payments",
          sourceDocumentType: original.direction === "RECEIPT" ? "customer_receipt" : "supplier_payment",
          sourceDocumentId: reversalId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.reversalDate);
      const number =
        original.direction === "RECEIPT"
          ? await allocateDocumentNumber(tx, actor.companyId, "payment_receipt_no", "RCT", fiscalYear)
          : await allocateDocumentNumber(tx, actor.companyId, "payment_out_no", "PAY", fiscalYear);

      // Keep the original allocations for history. Outstanding queries ignore them after voiding.

      // Create the reversal payment (zero allocations — amount fully on account to cancel out)
      await tx.payment.create({
        data: {
          id: reversalId,
          companyId: actor.companyId,
          direction: original.direction,
          number,
          partyId: original.partyId,
          counterpartyKind: original.counterpartyKind,
          counterAccountId: original.counterAccountId,
          paymentDate: input.reversalDate,
          amount,
          currency: original.currency,
          cashAccountId: original.cashAccountId,
          method: original.method,
          notes: blankToNull(input.notes),
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
          reversesPaymentId: original.id,
        },
      });

      // The referenced reversal must exist before linking the original to it.
      await tx.payment.update({ where: { id: original.id }, data: { voidedAt: input.reversalDate, reversedByPaymentId: reversalId } });

      return { id: reversalId, number, journalEntryId: posting.journalEntryId };
    });

    await this.audit.log({ actorId: actor.id, action: "payment.reversed", entityType: "Payment", entityId: input.paymentId, after: { reversalId: result.id }, correlationId });
    return result;
  }

  async list(companyId: string, query: PaymentListQuery): Promise<PaymentListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.payment.findMany({
      where: { companyId, ...(query.direction ? { direction: query.direction } : {}), ...(query.partyId ? { partyId: query.partyId } : {}) },
      include: { party: true, counterAccount: true, allocations: { select: { amount: true } } },
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
        counterpartyKind: (p.counterpartyKind ?? (p.direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER")) as PaymentCounterpartyKind,
        partyName: p.party?.name ?? p.counterAccount?.name ?? "",
        partyNameAr: p.party ? p.party.nameAr : p.counterAccount?.nameAr ?? null,
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

  // What is left to reconcile for a party on one side: money already received/paid that was never
  // tied to an invoice (an overpayment, or a deliberate on-account receipt), and invoices still
  // owing. Settling draws on the pool below oldest-payment-first — it never re-opens a question of
  // WHICH invoice an old receipt "belongs to", because at the ledger level it never belonged to one.
  private async availablePayments(db: TransactionClient, companyId: string, partyId: string, direction: PaymentDirection) {
    const payments = await db.payment.findMany({
      where: { companyId, partyId, voidedAt: null, reversesPaymentId: null, OR: [{ counterpartyKind: null, direction }, { counterpartyKind: direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER" }] },
      include: { allocations: { select: { amount: true } } },
      orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    // Refunds consume on-account money before it can be allocated again.
    let refunded = payments.filter((p) => p.direction !== direction).reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    return payments.filter((p) => p.direction === direction)
      .map((p) => ({ p, unallocated: p.amount.minus(p.allocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))) }))
      .map(({ p, unallocated }) => {
        const take = Prisma.Decimal.min(Prisma.Decimal.max(unallocated, 0), refunded);
        refunded = refunded.minus(take);
        return { p, unallocated: unallocated.minus(take) };
      })
      .filter((x) => x.unallocated.greaterThan(0))
      .map((x) => ({ id: x.p.id, number: x.p.number, paymentDate: dateOnly(x.p.paymentDate), method: x.p.method as PaymentMethod, unallocated: x.unallocated.toFixed(4) }));
  }

  async partyBalance(companyId: string, partyId: string, direction: PaymentDirection): Promise<PartyBalanceView> {
    const unallocatedPayments = await this.availablePayments(this.prisma, companyId, partyId, direction);
    const totalUnallocated = unallocatedPayments.reduce((sum, p) => sum.plus(p.unallocated), new Prisma.Decimal(0));
    return { totalUnallocated: totalUnallocated.toFixed(4), unallocatedPayments, openInvoices: await this.openInvoices(companyId, partyId, direction) };
  }

  // Ties existing on-account money to invoices that were open or did not exist yet when that money
  // came in. No cash moves and nothing is posted — the receipt/payment was already posted in full;
  // this only records which invoice(s) it is now considered to have settled, drawing on whichever of
  // the party's unallocated payments are oldest first, splitting across more than one if needed.
  async settle(input: SettleInput, actor: PaymentActor, correlationId: string): Promise<SettleResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM parties WHERE id = ${input.partyId} AND company_id = ${actor.companyId} AND is_active = true FOR UPDATE
      `;
      if (locked.length === 0) throw new PaymentError("PARTY_NOT_FOUND", "Party not found");

      const ids = input.allocations.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length) throw new PaymentError("DUPLICATE_ALLOCATION", "An invoice appears twice in the allocations");
      const side = sideOf(input.direction);
      const open = new Map((await loadOutstanding(tx, actor.companyId, side, { ids, partyId: input.partyId })).map((o) => [o.id, o]));

      const pool = (await this.availablePayments(tx, actor.companyId, input.partyId, input.direction))
        .map((p) => ({ id: p.id, remaining: new Prisma.Decimal(p.unallocated) }));

      let totalAllocated = new Prisma.Decimal(0);
      const newAllocations: { id: string; paymentId: string; amount: Prisma.Decimal; invoiceId: string }[] = [];
      for (const request of input.allocations) {
        const invoice = open.get(request.invoiceId);
        if (!invoice) throw new PaymentError("INVOICE_NOT_FOUND", "An invoice to settle was not found for this party");
        let left = new Prisma.Decimal(request.amount);
        if (left.greaterThan(invoice.outstanding)) throw new PaymentError("OVER_ALLOCATED", "More than that invoice still owes");
        totalAllocated = totalAllocated.plus(left);
        for (const slot of pool) {
          if (!left.greaterThan(0)) break;
          if (!slot.remaining.greaterThan(0)) continue;
          const take = left.lessThan(slot.remaining) ? left : slot.remaining;
          newAllocations.push({ id: newId(), paymentId: slot.id, amount: take, invoiceId: request.invoiceId });
          slot.remaining = slot.remaining.minus(take);
          left = left.minus(take);
        }
        if (left.greaterThan(0)) throw new PaymentError("INSUFFICIENT_BALANCE", "Not enough unallocated balance for this party to cover the requested amount");
      }

      await tx.paymentAllocation.createMany({
        data: newAllocations.map((a) => ({
          id: a.id,
          companyId: actor.companyId,
          paymentId: a.paymentId,
          amount: a.amount,
          ...(side === "SALES" ? { salesInvoiceId: a.invoiceId } : { supplierInvoiceId: a.invoiceId }),
        })),
      });

      return { totalAllocated: totalAllocated.toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "payment.settled", entityType: "Party", entityId: input.partyId, after: { ...result }, correlationId });
    return result;
  }
}
