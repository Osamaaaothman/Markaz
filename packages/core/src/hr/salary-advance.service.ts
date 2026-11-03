import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { advanceBalance, lockAdvancesOf } from "./salary-advance-balance.js";

export class SalaryAdvanceError extends Error {
  constructor(
    readonly code: "EMPLOYEE_NOT_FOUND" | "ADVANCE_NOT_FOUND" | "CASH_ACCOUNT_NOT_FOUND" | "CASH_ACCOUNT_INVALID" | "NO_OPEN_PERIOD" | "OVER_REPAYMENT" | "NOTHING_TO_REPAY",
    message: string,
  ) {
    super(message);
    this.name = "SalaryAdvanceError";
  }
}

export interface SalaryAdvanceActor {
  readonly id: string;
  readonly companyId: string;
}

export interface GrantSalaryAdvanceInput {
  readonly employeeId: string;
  readonly grantDate: Date;
  readonly amount: string;
  readonly installmentAmount: string;
  readonly cashAccountId: string;
}

export interface SalaryAdvanceResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
}

export interface SalaryAdvanceSummary {
  readonly id: string;
  readonly number: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly grantDate: string;
  readonly amount: string;
  readonly installmentAmount: string;
  readonly deducted: string;
  // Paid back directly (cash or bank), outside payroll.
  readonly repaid: string;
  readonly remaining: string;
}

export interface RepaySalaryAdvanceInput {
  readonly repaymentDate: Date;
  readonly amount: string;
  readonly cashAccountId: string;
}

export interface SalaryAdvanceRepaymentResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  // What is still owed on the advance after this repayment.
  readonly remaining: string;
}

type AdvanceRow = Prisma.SalaryAdvanceGetPayload<{ include: { employee: true; deductions: true; repayments: true } }>;

function toSummary(r: AdvanceRow): SalaryAdvanceSummary {
  const balance = advanceBalance(r);
  return {
    id: r.id,
    number: r.number,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    grantDate: r.grantDate.toISOString().slice(0, 10),
    amount: r.amount.toFixed(4),
    installmentAmount: r.installmentAmount.toFixed(4),
    deducted: balance.deducted.toFixed(4),
    repaid: balance.repaid.toFixed(4),
    remaining: balance.remaining.toFixed(4),
  };
}

// A cash advance against future salary: Dr Salary Advances Receivable, Cr the cash/bank account
// it was paid from -- the same shape as a payment, minus the party/invoice allocation machinery
// a payroll advance does not need. Recovery happens automatically, a bit per payroll run
// (PayrollRunService), never by editing this row.
export class SalaryAdvanceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async grant(input: GrantSalaryAdvanceInput, actor: SalaryAdvanceActor, correlationId: string, idempotencyKey: string): Promise<SalaryAdvanceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: input.employeeId, companyId: actor.companyId, isActive: true } });
      if (!employee) throw new SalaryAdvanceError("EMPLOYEE_NOT_FOUND", "Employee not found");

      const cash = await tx.account.findFirst({ where: { id: input.cashAccountId, companyId: actor.companyId } });
      if (!cash) throw new SalaryAdvanceError("CASH_ACCOUNT_NOT_FOUND", "The bank or cash account was not found");
      if (!cash.isPostable || cash.type !== "ASSET") throw new SalaryAdvanceError("CASH_ACCOUNT_INVALID", "Choose a postable asset account for the bank or cash");

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.grantDate);
      if (!period) throw new SalaryAdvanceError("NO_OPEN_PERIOD", "No open fiscal period covers the grant date");
      const currency = await companyCurrency(tx, actor.companyId);

      // The employee's own advance account if they have one, else the company-wide account. The choice is stored on the
      // advance, so its repayments and deductions always credit the account this grant debited.
      const advancesReceivableAccount = employee.advanceAccountId ?? (await this.accountMappings.resolve(tx, actor.companyId, "SALARY_ADVANCES_RECEIVABLE"));
      const amount = new Prisma.Decimal(input.amount);

      const journalLines: JournalLineInput[] = [
        { accountId: advancesReceivableAccount, debit: amount.toFixed(4), description: `Salary advance -- ${employee.name}` },
        { accountId: cash.id, credit: amount.toFixed(4), description: `Salary advance -- ${employee.name}` },
      ];

      const advanceId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.grantDate,
          postingDate: input.grantDate,
          currency,
          lines: journalLines,
          sourceModule: "hr",
          sourceDocumentType: "salary_advance",
          sourceDocumentId: advanceId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.grantDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "salary_advance_no", "ADV", fiscalYear);

      await tx.salaryAdvance.create({
        data: {
          id: advanceId,
          companyId: actor.companyId,
          employeeId: input.employeeId,
          number,
          grantDate: input.grantDate,
          amount,
          installmentAmount: new Prisma.Decimal(input.installmentAmount),
          cashAccountId: cash.id,
          receivableAccountId: employee.advanceAccountId,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        },
      });

      return { id: advanceId, number, journalEntryId: posting.journalEntryId };
    });

    await this.audit.log({ actorId: actor.id, action: "salary_advance.granted", entityType: "SalaryAdvance", entityId: result.id, after: result, correlationId });
    return result;
  }

  // The employee pays money back: Dr the bank or cash account, Cr Salary Advances Receivable. Allowed for an employee who
  // has left too (that is how a leaver clears the advance before the end-of-service settlement). The employee's advances are locked
  // (an advisory lock: the table is insert-only for the application role) so two repayments, or a repayment and a payroll run, cannot both take the same remaining amount.
  async repay(
    advanceId: string,
    input: RepaySalaryAdvanceInput,
    actor: SalaryAdvanceActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<SalaryAdvanceRepaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const found = await tx.salaryAdvance.findFirst({ where: { id: advanceId, companyId: actor.companyId }, select: { employeeId: true } });
      if (!found) throw new SalaryAdvanceError("ADVANCE_NOT_FOUND", "Salary advance not found");
      // Lock this employee's advances, then read the balance: a payroll run or another repayment now waits for this one.
      await lockAdvancesOf(tx, actor.companyId, [found.employeeId]);
      const advance = await tx.salaryAdvance.findUniqueOrThrow({ where: { id: advanceId }, include: { employee: true, deductions: true, repayments: true } });

      const amount = new Prisma.Decimal(input.amount);
      const remaining = advanceBalance(advance).remaining;
      if (remaining.lessThanOrEqualTo(0)) throw new SalaryAdvanceError("NOTHING_TO_REPAY", "This advance is already fully repaid");
      if (amount.greaterThan(remaining)) throw new SalaryAdvanceError("OVER_REPAYMENT", "The amount is more than what remains on this advance");

      const cash = await tx.account.findFirst({ where: { id: input.cashAccountId, companyId: actor.companyId } });
      if (!cash) throw new SalaryAdvanceError("CASH_ACCOUNT_NOT_FOUND", "The bank or cash account was not found");
      if (!cash.isPostable || cash.type !== "ASSET" || !cash.isActive) {
        throw new SalaryAdvanceError("CASH_ACCOUNT_INVALID", "Choose an active, postable asset account for the bank or cash");
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.repaymentDate);
      if (!period) throw new SalaryAdvanceError("NO_OPEN_PERIOD", "No open fiscal period covers the repayment date");
      const currency = await companyCurrency(tx, actor.companyId);
      // The account the advance was granted on (null = the company-wide one).
      const advancesReceivableAccount = advance.receivableAccountId ?? (await this.accountMappings.resolve(tx, actor.companyId, "SALARY_ADVANCES_RECEIVABLE"));

      const description = `Salary advance repayment -- ${advance.employee.name} (${advance.number})`;
      const repaymentId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.repaymentDate,
          postingDate: input.repaymentDate,
          currency,
          lines: [
            { accountId: cash.id, debit: amount.toFixed(4), description },
            { accountId: advancesReceivableAccount, credit: amount.toFixed(4), description },
          ],
          sourceModule: "hr",
          sourceDocumentType: "salary_advance_repayment",
          sourceDocumentId: repaymentId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.repaymentDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "salary_advance_repayment_no", "ARP", fiscalYear);
      await tx.salaryAdvanceRepayment.create({
        data: {
          id: repaymentId,
          companyId: actor.companyId,
          salaryAdvanceId: advanceId,
          number,
          repaymentDate: input.repaymentDate,
          amount,
          cashAccountId: cash.id,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        },
      });
      return { id: repaymentId, number, journalEntryId: posting.journalEntryId, remaining: remaining.minus(amount).toFixed(4) };
    });

    await this.audit.log({ actorId: actor.id, action: "salary_advance.repaid", entityType: "SalaryAdvance", entityId: advanceId, after: result, correlationId });
    return result;
  }

  async listForEmployee(employeeId: string, companyId: string): Promise<readonly SalaryAdvanceSummary[]> {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { employeeId, companyId },
      include: { employee: true, deductions: true, repayments: true },
      orderBy: { grantDate: "desc" },
    });
    return rows.map(toSummary);
  }

  async listAll(companyId: string): Promise<readonly SalaryAdvanceSummary[]> {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { companyId },
      include: { employee: true, deductions: true, repayments: true },
      orderBy: { grantDate: "desc" },
    });
    return rows.map(toSummary);
  }
}
