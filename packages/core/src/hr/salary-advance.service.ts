import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";

export class SalaryAdvanceError extends Error {
  constructor(
    readonly code: "EMPLOYEE_NOT_FOUND" | "CASH_ACCOUNT_NOT_FOUND" | "CASH_ACCOUNT_INVALID" | "NO_OPEN_PERIOD",
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
  readonly remaining: string;
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

      const advancesReceivableAccount = await this.accountMappings.resolve(tx, actor.companyId, "SALARY_ADVANCES_RECEIVABLE");
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

  async listForEmployee(employeeId: string, companyId: string): Promise<readonly SalaryAdvanceSummary[]> {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { employeeId, companyId },
      include: { employee: true, deductions: true },
      orderBy: { grantDate: "desc" },
    });
    return rows.map((r) => {
      const deducted = r.deductions.reduce((sum, d) => sum.plus(d.amount), new Prisma.Decimal(0));
      return {
        id: r.id,
        number: r.number,
        employeeId: r.employeeId,
        employeeName: r.employee.name,
        grantDate: r.grantDate.toISOString().slice(0, 10),
        amount: r.amount.toFixed(4),
        installmentAmount: r.installmentAmount.toFixed(4),
        deducted: deducted.toFixed(4),
        remaining: r.amount.minus(deducted).toFixed(4),
      };
    });
  }

  async listAll(companyId: string): Promise<readonly SalaryAdvanceSummary[]> {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { companyId },
      include: { employee: true, deductions: true },
      orderBy: { grantDate: "desc" },
    });
    return rows.map((r) => {
      const deducted = r.deductions.reduce((sum, d) => sum.plus(d.amount), new Prisma.Decimal(0));
      return {
        id: r.id,
        number: r.number,
        employeeId: r.employeeId,
        employeeName: r.employee.name,
        grantDate: r.grantDate.toISOString().slice(0, 10),
        amount: r.amount.toFixed(4),
        installmentAmount: r.installmentAmount.toFixed(4),
        deducted: deducted.toFixed(4),
        remaining: r.amount.minus(deducted).toFixed(4),
      };
    });
  }
}
