import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";

// Paying what payroll and end-of-service left owed. Each payment is the mirror of the entry that created the debt:
//   SALARY          Dr the account each net pay was credited to (the employee's own, or the company-wide one)   Cr bank / cash
//   GOSI            Dr GOSI payable                                                                              Cr bank / cash
//   END_OF_SERVICE  Dr the account the gratuity was credited to                                                  Cr bank / cash
// So after paying, the owed balances go back down and the bank goes down by the same amount. Nothing here is a new accounting
// treatment: both sides are fixed by the original entries.

export type HrPaymentKind = "SALARY" | "GOSI" | "END_OF_SERVICE";

export class HrPaymentError extends Error {
  constructor(
    readonly code:
      | "CASH_ACCOUNT_NOT_FOUND"
      | "CASH_ACCOUNT_INVALID"
      | "NO_OPEN_PERIOD"
      | "RUN_NOT_FOUND"
      | "SETTLEMENT_NOT_FOUND"
      | "NOTHING_TO_PAY"
      | "ALREADY_PAID"
      | "OVER_PAYMENT"
      | "BEFORE_SOURCE_DATE",
    message: string,
  ) {
    super(message);
    this.name = "HrPaymentError";
  }
}

export interface HrPaymentActor {
  readonly id: string;
  readonly companyId: string;
}

interface CommonInput {
  readonly paymentDate: Date;
  readonly cashAccountId: string;
  readonly notes?: string | undefined;
}

export interface PaySalariesInput extends CommonInput {
  readonly payrollRunId: string;
  // The employees to pay; left out = every employee on the run who has not been paid yet.
  readonly employeeIds?: readonly string[] | undefined;
}

export interface PayGosiInput extends CommonInput {
  readonly amount: string;
}

export interface PayEndOfServiceInput extends CommonInput {
  readonly settlementId: string;
}

export interface HrPaymentResult {
  readonly id: string;
  readonly number: string;
  readonly amount: string;
  readonly journalEntryId: string;
}

export interface HrPaymentSummary {
  readonly id: string;
  readonly kind: HrPaymentKind;
  readonly number: string;
  readonly paymentDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly payrollRunId: string | null;
  readonly payrollRunNumber: string | null;
  readonly settlementId: string | null;
  readonly settlementNumber: string | null;
  readonly employeeName: string | null;
  readonly employeeNameAr: string | null;
}

export interface HrPaymentDetail extends HrPaymentSummary {
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly notes: string | null;
  readonly journalEntryId: string;
  readonly items: readonly { readonly employeeId: string; readonly employeeRef: string; readonly employeeName: string; readonly employeeNameAr: string | null; readonly amount: string }[];
}

export interface HrPaymentListPage {
  readonly data: readonly HrPaymentSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

// What is still waiting to be paid, for the screen that offers the three payments.
export interface HrPayables {
  readonly currency: string;
  readonly runs: readonly { readonly payrollRunId: string; readonly number: string; readonly runDate: string; readonly unpaidCount: number; readonly unpaidTotal: string }[];
  readonly gosiOutstanding: string;
  readonly settlements: readonly { readonly settlementId: string; readonly number: string; readonly employeeName: string; readonly employeeNameAr: string | null; readonly terminationDate: string; readonly amount: string }[];
}

const PREFIX: Record<HrPaymentKind, { readonly type: string; readonly prefix: string }> = {
  SALARY: { type: "hr_salary_payment_no", prefix: "SPY" },
  GOSI: { type: "hr_gosi_payment_no", prefix: "GPY" },
  END_OF_SERVICE: { type: "hr_eosb_payment_no", prefix: "EPY" },
};

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const zero = (): Prisma.Decimal => new Prisma.Decimal(0);

export class HrPaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  // What each payment screen can offer right now.
  async payables(companyId: string): Promise<HrPayables> {
    const currency = await companyCurrency(this.prisma, companyId);
    const lines = await this.prisma.payrollRunLine.findMany({
      where: { companyId, net: { gt: 0 }, paymentItem: null },
      select: { net: true, payrollRun: { select: { id: true, number: true, runDate: true } } },
    });
    const byRun = new Map<string, { payrollRunId: string; number: string; runDate: string; unpaidCount: number; unpaidTotal: Prisma.Decimal }>();
    for (const l of lines) {
      const row = byRun.get(l.payrollRun.id) ?? { payrollRunId: l.payrollRun.id, number: l.payrollRun.number, runDate: dateOnly(l.payrollRun.runDate), unpaidCount: 0, unpaidTotal: zero() };
      row.unpaidCount += 1;
      row.unpaidTotal = row.unpaidTotal.plus(l.net);
      byRun.set(l.payrollRun.id, row);
    }
    const settlements = await this.prisma.endOfServiceSettlement.findMany({
      where: { companyId, netEntitlement: { gt: 0 }, payment: null },
      include: { employee: { select: { name: true, nameAr: true } } },
      orderBy: { terminationDate: "desc" },
    });
    return {
      currency,
      runs: [...byRun.values()].sort((a, b) => b.runDate.localeCompare(a.runDate)).map((r) => ({ ...r, unpaidTotal: r.unpaidTotal.toFixed(4) })),
      gosiOutstanding: (await this.gosiOutstanding(this.prisma, companyId)).toFixed(4),
      settlements: settlements.map((s) => ({ settlementId: s.id, number: s.number, employeeName: s.employee.name, employeeNameAr: s.employee.nameAr, terminationDate: dateOnly(s.terminationDate), amount: s.netEntitlement.toFixed(4) })),
    };
  }

  // GOSI owed = what the runs credited (employee + employer shares) minus what has been remitted.
  private async gosiOutstanding(db: Pick<PrismaClient, "payrollRun" | "hrPayment">, companyId: string): Promise<Prisma.Decimal> {
    const owed = await db.payrollRun.aggregate({ where: { companyId }, _sum: { totalGosiEmployee: true, totalGosiEmployer: true } });
    const paid = await db.hrPayment.aggregate({ where: { companyId, kind: "GOSI" }, _sum: { amount: true } });
    return (owed._sum.totalGosiEmployee ?? zero()).plus(owed._sum.totalGosiEmployer ?? zero()).minus(paid._sum.amount ?? zero());
  }

  private async cashAccount(tx: TransactionClient, companyId: string, id: string) {
    const cash = await tx.account.findFirst({ where: { id, companyId } });
    if (!cash) throw new HrPaymentError("CASH_ACCOUNT_NOT_FOUND", "The bank or cash account was not found");
    if (!cash.isPostable || cash.type !== "ASSET" || !cash.isActive) throw new HrPaymentError("CASH_ACCOUNT_INVALID", "Choose an active, postable asset account for the bank or cash");
    return cash;
  }

  // Posts the entry and records the payment. `debits` are the accounts whose debt is being paid off.
  private async post(
    tx: TransactionClient,
    actor: HrPaymentActor,
    kind: HrPaymentKind,
    input: CommonInput,
    debits: readonly { readonly accountId: string; readonly amount: Prisma.Decimal; readonly description: string }[],
    link: { readonly payrollRunId?: string; readonly settlementId?: string },
    items: readonly { readonly payrollRunLineId: string; readonly employeeId: string; readonly amount: Prisma.Decimal; readonly accountId: string }[],
    correlationId: string,
    idempotencyKey: string,
  ): Promise<HrPaymentResult> {
    const cash = await this.cashAccount(tx, actor.companyId, input.cashAccountId);
    const period = await findOpenFiscalPeriod(tx, actor.companyId, input.paymentDate);
    if (!period) throw new HrPaymentError("NO_OPEN_PERIOD", "No open fiscal period covers the payment date");
    const currency = await companyCurrency(tx, actor.companyId);
    const total = debits.reduce((sum, d) => sum.plus(d.amount), zero());

    const lines: JournalLineInput[] = [
      ...debits.map((d) => ({ accountId: d.accountId, debit: d.amount.toFixed(4), description: d.description })),
      { accountId: cash.id, credit: total.toFixed(4), description: `${kind === "SALARY" ? "Salary payment" : kind === "GOSI" ? "Social insurance payment" : "End-of-service payment"}` },
    ];
    const id = newId();
    const posting = await this.engine.postEntry(
      {
        companyId: actor.companyId,
        fiscalPeriodId: period.id,
        entryDate: input.paymentDate,
        postingDate: input.paymentDate,
        currency,
        lines,
        sourceModule: "hr",
        sourceDocumentType: "hr_payment",
        sourceDocumentId: id,
        actorId: actor.id,
        correlationId,
        idempotencyKey,
      },
      tx,
    );
    const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.paymentDate);
    const number = await allocateDocumentNumber(tx, actor.companyId, PREFIX[kind].type, PREFIX[kind].prefix, fiscalYear);
    await tx.hrPayment.create({
      data: {
        id,
        companyId: actor.companyId,
        kind,
        number,
        paymentDate: input.paymentDate,
        amount: total,
        currency,
        cashAccountId: cash.id,
        payrollRunId: link.payrollRunId ?? null,
        settlementId: link.settlementId ?? null,
        notes: input.notes?.trim() ? input.notes.trim() : null,
        journalEntryId: posting.journalEntryId,
        actorId: actor.id,
        correlationId,
      },
    });
    for (const item of items) {
      await tx.hrPaymentItem.create({ data: { id: newId(), companyId: actor.companyId, hrPaymentId: id, payrollRunLineId: item.payrollRunLineId, employeeId: item.employeeId, amount: item.amount, accountId: item.accountId } });
    }
    return { id, number, amount: total.toFixed(4), journalEntryId: posting.journalEntryId };
  }

  private async audited(result: HrPaymentResult, kind: HrPaymentKind, actor: HrPaymentActor, correlationId: string): Promise<HrPaymentResult> {
    await this.audit.log({ actorId: actor.id, action: `hr_payment.${kind.toLowerCase()}_posted`, entityType: "HrPayment", entityId: result.id, after: { ...result }, correlationId });
    return result;
  }

  // Pays the net salaries of a run (all unpaid, or the chosen employees). A salary line can be paid once, enforced by a unique key,
  // and the run is locked meanwhile so two clicks cannot pay the same line twice.
  async paySalaries(input: PaySalariesInput, actor: HrPaymentActor, correlationId: string, idempotencyKey: string): Promise<HrPaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hr-payment:run:${input.payrollRunId}`}))`;
      const run = await tx.payrollRun.findFirst({ where: { id: input.payrollRunId, companyId: actor.companyId }, select: { id: true, runDate: true } });
      if (!run) throw new HrPaymentError("RUN_NOT_FOUND", "Payroll run not found");
      if (input.paymentDate.getTime() < run.runDate.getTime()) throw new HrPaymentError("BEFORE_SOURCE_DATE", "The payment date is before the payroll run date");

      const lines = await tx.payrollRunLine.findMany({
        where: { payrollRunId: run.id, companyId: actor.companyId, net: { gt: 0 }, paymentItem: null, ...(input.employeeIds ? { employeeId: { in: [...input.employeeIds] } } : {}) },
        include: { employee: { select: { name: true } } },
      });
      if (lines.length === 0) throw new HrPaymentError("NOTHING_TO_PAY", "Nothing is left to pay on this run");

      // A run made before the account was stored used the company-wide account.
      const general = lines.some((l) => l.netPayAccountId === null) ? await this.accountMappings.resolve(tx, actor.companyId, "NET_PAY_PAYABLE") : null;
      const resolved = lines.map((l) => ({ line: l, accountId: l.netPayAccountId ?? general! }));
      const byAccount = new Map<string, { amount: Prisma.Decimal; names: string[] }>();
      for (const r of resolved) {
        const entry = byAccount.get(r.accountId) ?? { amount: zero(), names: [] };
        entry.amount = entry.amount.plus(r.line.net);
        entry.names.push(r.line.employee.name);
        byAccount.set(r.accountId, entry);
      }
      const debits = [...byAccount].map(([accountId, e]) => ({ accountId, amount: e.amount, description: `Salary payment -- ${e.names.length === 1 ? e.names[0]! : `${e.names.length} employees`}` }));
      return this.post(
        tx,
        actor,
        "SALARY",
        input,
        debits,
        { payrollRunId: run.id },
        resolved.map((r) => ({ payrollRunLineId: r.line.id, employeeId: r.line.employeeId, amount: r.line.net, accountId: r.accountId })),
        correlationId,
        idempotencyKey,
      );
    });
    return this.audited(result, "SALARY", actor, correlationId);
  }

  // Remits social insurance, in full or in part, never more than is owed.
  async payGosi(input: PayGosiInput, actor: HrPaymentActor, correlationId: string, idempotencyKey: string): Promise<HrPaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hr-payment:gosi:${actor.companyId}`}))`;
      const amount = new Prisma.Decimal(input.amount);
      const outstanding = await this.gosiOutstanding(tx, actor.companyId);
      if (outstanding.lessThanOrEqualTo(0)) throw new HrPaymentError("NOTHING_TO_PAY", "No social insurance is owed");
      if (amount.greaterThan(outstanding)) throw new HrPaymentError("OVER_PAYMENT", `Only ${outstanding.toFixed(4)} is owed`);
      const payable = await this.accountMappings.resolve(tx, actor.companyId, "GOSI_PAYABLE");
      return this.post(tx, actor, "GOSI", input, [{ accountId: payable, amount, description: "Social insurance remitted" }], {}, [], correlationId, idempotencyKey);
    });
    return this.audited(result, "GOSI", actor, correlationId);
  }

  // Pays an employee's end-of-service gratuity, once.
  async payEndOfService(input: PayEndOfServiceInput, actor: HrPaymentActor, correlationId: string, idempotencyKey: string): Promise<HrPaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hr-payment:settlement:${input.settlementId}`}))`;
      const settlement = await tx.endOfServiceSettlement.findFirst({ where: { id: input.settlementId, companyId: actor.companyId }, include: { employee: { select: { name: true } }, payment: { select: { id: true } } } });
      if (!settlement) throw new HrPaymentError("SETTLEMENT_NOT_FOUND", "End-of-service settlement not found");
      if (settlement.payment) throw new HrPaymentError("ALREADY_PAID", "This gratuity has already been paid");
      if (settlement.netEntitlement.lessThanOrEqualTo(0)) throw new HrPaymentError("NOTHING_TO_PAY", "Nothing is owed on this settlement");
      if (input.paymentDate.getTime() < settlement.terminationDate.getTime()) throw new HrPaymentError("BEFORE_SOURCE_DATE", "The payment date is before the termination date");
      const accountId = settlement.payableAccountId ?? (await this.accountMappings.resolve(tx, actor.companyId, "EOSB_PAYABLE"));
      return this.post(tx, actor, "END_OF_SERVICE", input, [{ accountId, amount: settlement.netEntitlement, description: `End-of-service payment -- ${settlement.employee.name}` }], { settlementId: settlement.id }, [], correlationId, idempotencyKey);
    });
    return this.audited(result, "END_OF_SERVICE", actor, correlationId);
  }

  async list(companyId: string, query: { cursor?: string | undefined; limit?: string | undefined; kind?: HrPaymentKind | undefined }): Promise<HrPaymentListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.hrPayment.findMany({
      where: { companyId, ...(query.kind ? { kind: query.kind } : {}) },
      include: { payrollRun: { select: { number: true } }, settlement: { select: { number: true, employee: { select: { name: true, nameAr: true } } } } },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(id: string, companyId: string): Promise<HrPaymentDetail | null> {
    const p = await this.prisma.hrPayment.findFirst({
      where: { id, companyId },
      include: {
        payrollRun: { select: { number: true } },
        settlement: { select: { number: true, employee: { select: { name: true, nameAr: true } } } },
        cashAccount: { select: { code: true, name: true, nameAr: true } },
        items: { include: { employee: { select: { ref: true, name: true, nameAr: true } } }, orderBy: { employee: { name: "asc" } } },
      },
    });
    if (!p) return null;
    return {
      ...toSummary(p),
      cashAccountCode: p.cashAccount.code,
      cashAccountName: p.cashAccount.name,
      cashAccountNameAr: p.cashAccount.nameAr,
      notes: p.notes,
      journalEntryId: p.journalEntryId,
      items: p.items.map((i) => ({ employeeId: i.employeeId, employeeRef: i.employee.ref, employeeName: i.employee.name, employeeNameAr: i.employee.nameAr, amount: i.amount.toFixed(4) })),
    };
  }
}

function toSummary(p: {
  id: string;
  kind: string;
  number: string;
  paymentDate: Date;
  amount: Prisma.Decimal;
  currency: string;
  payrollRunId: string | null;
  settlementId: string | null;
  payrollRun: { number: string } | null;
  settlement: { number: string; employee: { name: string; nameAr: string | null } } | null;
}): HrPaymentSummary {
  return {
    id: p.id,
    kind: p.kind as HrPaymentKind,
    number: p.number,
    paymentDate: dateOnly(p.paymentDate),
    amount: p.amount.toFixed(4),
    currency: p.currency,
    payrollRunId: p.payrollRunId,
    payrollRunNumber: p.payrollRun?.number ?? null,
    settlementId: p.settlementId,
    settlementNumber: p.settlement?.number ?? null,
    employeeName: p.settlement?.employee.name ?? null,
    employeeNameAr: p.settlement?.employee.nameAr ?? null,
  };
}
