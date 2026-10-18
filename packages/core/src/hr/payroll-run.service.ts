import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { GosiLegacyTrackError, computeGosiContribution } from "./gosi.js";

export class PayrollRunError extends Error {
  constructor(
    readonly code: "NO_ACTIVE_EMPLOYEES" | "PERIOD_ALREADY_RUN" | "NO_OPEN_PERIOD",
    message: string,
  ) {
    super(message);
    this.name = "PayrollRunError";
  }
}

export interface PayrollRunActor {
  readonly id: string;
  readonly companyId: string;
}

export interface CreatePayrollRunInput {
  readonly periodYear: number;
  readonly periodMonth: number; // 1-12
  readonly runDate: Date;
}

export interface PayrollRunLineResult {
  readonly employeeId: string;
  readonly employeeRef: string;
  readonly employeeName: string;
  readonly basicSalary: string;
  readonly housingAllowance: string;
  readonly otherAllowances: string;
  readonly gross: string;
  readonly gosiEmployeeShare: string;
  readonly gosiEmployerShare: string;
  readonly advanceDeduction: string;
  readonly net: string;
}

// One payslip line within a run's detail view -- adds the fields a payslip PDF needs
// (employeeRef, nationalId, bankIban) that the posting-time result above does not carry.
export interface PayrollRunLine {
  readonly employeeId: string;
  readonly employeeRef: string;
  readonly employeeName: string;
  readonly employeeNameAr: string | null;
  readonly nationalId: string;
  readonly bankIban: string;
  readonly basicSalary: string;
  readonly housingAllowance: string;
  readonly otherAllowances: string;
  readonly gross: string;
  readonly gosiEmployeeShare: string;
  readonly gosiEmployerShare: string;
  readonly advanceDeduction: string;
  readonly net: string;
}

export interface PayrollRunDetail {
  readonly id: string;
  readonly number: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalGross: string;
  readonly totalGosiEmployee: string;
  readonly totalGosiEmployer: string;
  readonly totalAdvanceDeduction: string;
  readonly totalNet: string;
  readonly journalEntryId: string;
  readonly lines: readonly PayrollRunLine[];
}

export interface PayrollRunResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly totalGross: string;
  readonly totalGosiEmployee: string;
  readonly totalGosiEmployer: string;
  readonly totalAdvanceDeduction: string;
  readonly totalNet: string;
  readonly lines: readonly PayrollRunLineResult[];
  // Active employees left out of this run because Employee.gosiLegacyTrack is set -- GOSI for
  // them needs a human, not this module (see packages/core/src/hr/gosi.ts).
  readonly excludedLegacyTrackEmployees: readonly { readonly id: string; readonly name: string }[];
}

// One payroll run = one employee roster snapshot + one balanced journal entry, posted all
// together inside one transaction, the same all-or-nothing shape as every other posting service
// (docs/02-ARCHITECTURE-RULES.md §5). The entry is aggregated across every employee in the run,
// not one line pair per employee -- debit/credit still balances; per-employee detail lives in
// PayrollRunLine, not in the ledger:
//
//   Dr Salary Expense              sum(gross)
//   Dr GOSI Employer Expense       sum(gosiEmployerShare)
//   Cr GOSI Payable                sum(gosiEmployeeShare + gosiEmployerShare)
//   Cr Salary Advances Receivable  sum(advanceDeduction)   (only if > 0)
//   Cr Net Pay Payable             sum(net)
export class PayrollRunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreatePayrollRunInput, actor: PayrollRunActor, correlationId: string, idempotencyKey: string): Promise<PayrollRunResult> {
    const existing = await this.prisma.payrollRun.findUnique({
      where: { companyId_periodYear_periodMonth: { companyId: actor.companyId, periodYear: input.periodYear, periodMonth: input.periodMonth } },
    });
    if (existing) throw new PayrollRunError("PERIOD_ALREADY_RUN", "A payroll run already exists for this period");

    const employees = await this.prisma.employee.findMany({
      where: { companyId: actor.companyId, isActive: true, hireDate: { lte: input.runDate } },
    });
    if (employees.length === 0) throw new PayrollRunError("NO_ACTIVE_EMPLOYEES", "No active employee is eligible for this run");

    const eligible = employees.filter((e) => !e.gosiLegacyTrack);
    const excluded = employees.filter((e) => e.gosiLegacyTrack).map((e) => ({ id: e.id, name: e.name }));
    if (eligible.length === 0) throw new PayrollRunError("NO_ACTIVE_EMPLOYEES", "No active employee is eligible for this run");

    // Outstanding advances for every eligible employee, each with its remaining balance computed
    // from its own deduction history -- never a stored balance (see the model's own comment).
    const advances = await this.prisma.salaryAdvance.findMany({
      where: { companyId: actor.companyId, employeeId: { in: eligible.map((e) => e.id) } },
      include: { deductions: true },
      orderBy: { grantDate: "asc" },
    });
    const advancesByEmployee = new Map<string, typeof advances>();
    for (const advance of advances) {
      const list = advancesByEmployee.get(advance.employeeId) ?? [];
      list.push(advance);
      advancesByEmployee.set(advance.employeeId, list);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.runDate);
      if (!period) throw new PayrollRunError("NO_OPEN_PERIOD", "No open fiscal period covers the run date");
      const currency = await companyCurrency(tx, actor.companyId);

      const salaryExpenseAccount = await this.accountMappings.resolve(tx, actor.companyId, "SALARY_EXPENSE");
      const gosiEmployerExpenseAccount = await this.accountMappings.resolve(tx, actor.companyId, "GOSI_EMPLOYER_EXPENSE");
      const gosiPayableAccount = await this.accountMappings.resolve(tx, actor.companyId, "GOSI_PAYABLE");
      const netPayPayableAccount = await this.accountMappings.resolve(tx, actor.companyId, "NET_PAY_PAYABLE");
      const advancesReceivableAccount = await this.accountMappings.resolve(tx, actor.companyId, "SALARY_ADVANCES_RECEIVABLE");

      let totalGross = new Prisma.Decimal(0);
      let totalGosiEmployee = new Prisma.Decimal(0);
      let totalGosiEmployer = new Prisma.Decimal(0);
      let totalAdvanceDeduction = new Prisma.Decimal(0);
      let totalNet = new Prisma.Decimal(0);

      const lineRows: {
        readonly id: string;
        readonly employeeId: string;
        readonly basicSalary: Prisma.Decimal;
        readonly housingAllowance: Prisma.Decimal;
        readonly otherAllowances: Prisma.Decimal;
        readonly gross: Prisma.Decimal;
        readonly gosiEmployeeShare: Prisma.Decimal;
        readonly gosiEmployerShare: Prisma.Decimal;
        readonly advanceDeduction: Prisma.Decimal;
        readonly net: Prisma.Decimal;
        readonly advanceDeductionsApplied: readonly { readonly salaryAdvanceId: string; readonly amount: Prisma.Decimal }[];
      }[] = [];

      for (const employee of eligible) {
        const basicSalary = employee.basicSalary;
        const housingAllowance = employee.housingAllowance;
        const otherAllowances = employee.otherAllowances;
        const gross = basicSalary.plus(housingAllowance).plus(otherAllowances);

        const gosi = computeGosiContribution({
          basicSalary: basicSalary.toFixed(4),
          housingAllowance: housingAllowance.toFixed(4),
          isSaudi: employee.isSaudi,
          gosiLegacyTrack: false,
          asOf: input.runDate,
        });
        const gosiEmployeeShare = new Prisma.Decimal(gosi.employeeShare);
        const gosiEmployerShare = new Prisma.Decimal(gosi.employerShare);

        // Apply this employee's outstanding advances, oldest first, each up to its own
        // installment amount and never more than what remains on it.
        let advanceDeduction = new Prisma.Decimal(0);
        const applied: { salaryAdvanceId: string; amount: Prisma.Decimal }[] = [];
        for (const advance of advancesByEmployee.get(employee.id) ?? []) {
          const alreadyDeducted = advance.deductions.reduce((sum, d) => sum.plus(d.amount), new Prisma.Decimal(0));
          const remaining = advance.amount.minus(alreadyDeducted);
          if (remaining.lessThanOrEqualTo(0)) continue;
          const take = Prisma.Decimal.min(remaining, advance.installmentAmount);
          if (take.lessThanOrEqualTo(0)) continue;
          applied.push({ salaryAdvanceId: advance.id, amount: take });
          advanceDeduction = advanceDeduction.plus(take);
        }

        const net = gross.minus(gosiEmployeeShare).minus(advanceDeduction);

        totalGross = totalGross.plus(gross);
        totalGosiEmployee = totalGosiEmployee.plus(gosiEmployeeShare);
        totalGosiEmployer = totalGosiEmployer.plus(gosiEmployerShare);
        totalAdvanceDeduction = totalAdvanceDeduction.plus(advanceDeduction);
        totalNet = totalNet.plus(net);

        lineRows.push({
          id: newId(),
          employeeId: employee.id,
          basicSalary,
          housingAllowance,
          otherAllowances,
          gross,
          gosiEmployeeShare,
          gosiEmployerShare,
          advanceDeduction,
          net,
          advanceDeductionsApplied: applied,
        });
      }

      const journalLines: JournalLineInput[] = [
        { accountId: salaryExpenseAccount, debit: totalGross.toFixed(4), description: "Payroll run -- gross salaries" },
        { accountId: gosiEmployerExpenseAccount, debit: totalGosiEmployer.toFixed(4), description: "Payroll run -- employer GOSI share" },
        { accountId: gosiPayableAccount, credit: totalGosiEmployee.plus(totalGosiEmployer).toFixed(4), description: "Payroll run -- GOSI payable" },
        ...(totalAdvanceDeduction.greaterThan(0)
          ? [{ accountId: advancesReceivableAccount, credit: totalAdvanceDeduction.toFixed(4), description: "Payroll run -- advances recovered" }]
          : []),
        { accountId: netPayPayableAccount, credit: totalNet.toFixed(4), description: "Payroll run -- net pay payable" },
      ];

      const payrollRunId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.runDate,
          postingDate: input.runDate,
          currency,
          lines: journalLines,
          sourceModule: "hr",
          sourceDocumentType: "payroll_run",
          sourceDocumentId: payrollRunId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.runDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "payroll_run_no", "PYR", fiscalYear);

      await tx.payrollRun.create({
        data: {
          id: payrollRunId,
          companyId: actor.companyId,
          number,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          runDate: input.runDate,
          currency,
          totalGross,
          totalGosiEmployee,
          totalGosiEmployer,
          totalAdvanceDeduction,
          totalNet,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        },
      });

      for (const line of lineRows) {
        await tx.payrollRunLine.create({
          data: {
            id: line.id,
            companyId: actor.companyId,
            payrollRunId,
            employeeId: line.employeeId,
            basicSalary: line.basicSalary,
            housingAllowance: line.housingAllowance,
            otherAllowances: line.otherAllowances,
            gross: line.gross,
            gosiEmployeeShare: line.gosiEmployeeShare,
            gosiEmployerShare: line.gosiEmployerShare,
            advanceDeduction: line.advanceDeduction,
            net: line.net,
          },
        });
        for (const applied of line.advanceDeductionsApplied) {
          await tx.salaryAdvanceDeduction.create({
            data: { id: newId(), companyId: actor.companyId, salaryAdvanceId: applied.salaryAdvanceId, payrollRunLineId: line.id, amount: applied.amount },
          });
        }
      }

      return {
        id: payrollRunId,
        number,
        journalEntryId: posting.journalEntryId,
        totalGross: totalGross.toFixed(4),
        totalGosiEmployee: totalGosiEmployee.toFixed(4),
        totalGosiEmployer: totalGosiEmployer.toFixed(4),
        totalAdvanceDeduction: totalAdvanceDeduction.toFixed(4),
        totalNet: totalNet.toFixed(4),
        lines: lineRows.map((l) => {
          const employee = eligible.find((e) => e.id === l.employeeId)!;
          return {
            employeeId: l.employeeId,
            employeeRef: employee.ref,
            employeeName: employee.name,
            basicSalary: l.basicSalary.toFixed(4),
            housingAllowance: l.housingAllowance.toFixed(4),
            otherAllowances: l.otherAllowances.toFixed(4),
            gross: l.gross.toFixed(4),
            gosiEmployeeShare: l.gosiEmployeeShare.toFixed(4),
            gosiEmployerShare: l.gosiEmployerShare.toFixed(4),
            advanceDeduction: l.advanceDeduction.toFixed(4),
            net: l.net.toFixed(4),
          };
        }),
        excludedLegacyTrackEmployees: excluded,
      };
    });

    await this.audit.log({
      actorId: actor.id,
      action: "payroll_run.posted",
      entityType: "PayrollRun",
      entityId: result.id,
      after: { number: result.number, totalNet: result.totalNet, employeeCount: result.lines.length },
      correlationId,
    });
    return result;
  }

  async get(id: string, companyId: string): Promise<PayrollRunDetail | null> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, companyId },
      include: { lines: { include: { employee: true }, orderBy: { employee: { name: "asc" } } } },
    });
    if (!run) return null;
    return {
      id: run.id,
      number: run.number,
      periodYear: run.periodYear,
      periodMonth: run.periodMonth,
      runDate: run.runDate.toISOString().slice(0, 10),
      currency: run.currency,
      totalGross: run.totalGross.toFixed(4),
      totalGosiEmployee: run.totalGosiEmployee.toFixed(4),
      totalGosiEmployer: run.totalGosiEmployer.toFixed(4),
      totalAdvanceDeduction: run.totalAdvanceDeduction.toFixed(4),
      totalNet: run.totalNet.toFixed(4),
      journalEntryId: run.journalEntryId,
      lines: run.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeRef: l.employee.ref,
        employeeName: l.employee.name,
        employeeNameAr: l.employee.nameAr,
        nationalId: l.employee.nationalId,
        bankIban: l.employee.bankIban,
        basicSalary: l.basicSalary.toFixed(4),
        housingAllowance: l.housingAllowance.toFixed(4),
        otherAllowances: l.otherAllowances.toFixed(4),
        gross: l.gross.toFixed(4),
        gosiEmployeeShare: l.gosiEmployeeShare.toFixed(4),
        gosiEmployerShare: l.gosiEmployerShare.toFixed(4),
        advanceDeduction: l.advanceDeduction.toFixed(4),
        net: l.net.toFixed(4),
      })),
    };
  }

  async list(companyId: string) {
    const runs = await this.prisma.payrollRun.findMany({ where: { companyId }, orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }] });
    return runs.map((r) => ({
      id: r.id,
      number: r.number,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      runDate: r.runDate.toISOString().slice(0, 10),
      totalNet: r.totalNet.toFixed(4),
      currency: r.currency,
    }));
  }
}

// Re-exported so callers that only need to check the legacy-track guard do not have to import
// from ./gosi.js directly.
export { GosiLegacyTrackError };
