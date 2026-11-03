import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { EmployeeError, EmployeeService } from "./employee.service.js";
import { EndOfServiceError, EndOfServiceService } from "./end-of-service.service.js";
import { ChartOfAccountsService } from "../accounting/chart-of-accounts.service.js";
import { PayrollRunService } from "./payroll-run.service.js";
import { SalaryAdvanceError, SalaryAdvanceService } from "./salary-advance.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Salary advance repayment — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const employees = new EmployeeService(prisma, audit);
  const payrollRuns = new PayrollRunService(prisma, engine, mappings, audit);
  const salaryAdvances = new SalaryAdvanceService(prisma, engine, mappings, audit);
  const endOfService = new EndOfServiceService(prisma, engine, mappings, audit);
  const chart = new ChartOfAccountsService(prisma, audit);

  const companyId = newId();
  const otherCompanyId = newId();
  const actor = { id: "hr-clerk", companyId };
  const outsider = { id: "hr-clerk", companyId: otherCompanyId };
  const cid = (): string => newId();
  const day = new Date(Date.UTC(2026, 9, 18));

  let acc: Record<string, string>;
  let counter = 0;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  const newEmployee = async (): Promise<string> =>
    (
      await employees.create(
        { name: `Employee ${++counter}`, nationalId: `30000000${String(counter).padStart(2, "0")}`, isSaudi: false, bankIban: `SA00000000000000000${String(counter).padStart(5, "0")}`, hireDate: new Date(Date.UTC(2021, 0, 1)), basicSalary: "5000" },
        actor,
        cid(),
      )
    ).id;

  const grant = (employeeId: string, amount: string, installment: string) =>
    salaryAdvances.grant({ employeeId, grantDate: day, amount, installmentAmount: installment, cashAccountId: acc.bank! }, actor, cid(), newId());

  const repay = (advanceId: string, amount: string, cashAccountId = acc.bank!) =>
    salaryAdvances.repay(advanceId, { repaymentDate: day, amount, cashAccountId }, actor, cid(), newId());

  async function failsWith(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "no error";
    } catch (error) {
      if (error instanceof SalaryAdvanceError || error instanceof EndOfServiceError || error instanceof EmployeeError) return error.code;
      throw error;
    }
  }

  beforeAll(async () => {
    for (const id of [companyId, otherCompanyId]) await prisma.company.create({ data: { id, name: `Repayment Test ${id}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY2026-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance, isPostable: true } })).id;
    acc = {
      bank: await make("1010", "Bank", "ASSET", "DEBIT"),
      expense: await make("5100", "Salary expense", "EXPENSE", "DEBIT"),
      gosiEmployerExpense: await make("5110", "GOSI employer expense", "EXPENSE", "DEBIT"),
      gosiPayable: await make("2110", "GOSI payable", "LIABILITY", "CREDIT"),
      netPay: await make("2120", "Net pay payable", "LIABILITY", "CREDIT"),
      advances: await make("1210", "Salary advances receivable", "ASSET", "DEBIT"),
      eosbExpense: await make("5120", "End-of-service expense", "EXPENSE", "DEBIT"),
      eosbPayable: await make("2130", "End-of-service payable", "LIABILITY", "CREDIT"),
      revenue: await make("4100", "Revenue", "REVENUE", "CREDIT"),
    };
    await mappings.set("SALARY_EXPENSE", acc.expense!, actor, cid());
    await mappings.set("GOSI_EMPLOYER_EXPENSE", acc.gosiEmployerExpense!, actor, cid());
    await mappings.set("GOSI_PAYABLE", acc.gosiPayable!, actor, cid());
    await mappings.set("NET_PAY_PAYABLE", acc.netPay!, actor, cid());
    await mappings.set("SALARY_ADVANCES_RECEIVABLE", acc.advances!, actor, cid());
    await mappings.set("EOSB_EXPENSE", acc.eosbExpense!, actor, cid());
    await mappings.set("EOSB_PAYABLE", acc.eosbPayable!, actor, cid());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("takes a repayment in parts, books Dr bank / Cr advances receivable, and refuses more than remains", async () => {
    const employeeId = await newEmployee();
    const advance = await grant(employeeId, "1000", "300");
    const bankBefore = await balance(acc.bank!);
    const advancesBefore = await balance(acc.advances!);

    const first = await repay(advance.id, "400");
    expect(first.remaining).toBe("600.0000");
    expect(first.number).toMatch(/^ARP-/);
    expect(await balance(acc.bank!)).toBeCloseTo(bankBefore + 400, 4);
    expect(await balance(acc.advances!)).toBeCloseTo(advancesBefore - 400, 4);

    expect(await failsWith(repay(advance.id, "700"))).toBe("OVER_REPAYMENT");
    expect((await repay(advance.id, "600")).remaining).toBe("0.0000");
    expect(await failsWith(repay(advance.id, "1"))).toBe("NOTHING_TO_REPAY");

    const listed = (await salaryAdvances.listForEmployee(employeeId, companyId))[0]!;
    expect(listed).toMatchObject({ amount: "1000.0000", deducted: "0.0000", repaid: "1000.0000", remaining: "0.0000" });
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("counts a repayment as use of its bank account, so that account cannot be deleted", async () => {
    const bank = await prisma.account.create({ data: { id: newId(), ref: `TEST-BANK2-${companyId.slice(0, 6)}`, companyId, code: "1020", name: "Second bank", type: "ASSET", normalBalance: "DEBIT", isPostable: true } });
    const advance = await grant(await newEmployee(), "100", "50");
    await repay(advance.id, "40", bank.id);
    const usage = await chart.usage(bank.id, actor);
    expect(usage.usage.salaryAdvanceRepayments).toBe(1);
    expect(usage.canDelete).toBe(false);
    await expect(chart.delete(bank.id, actor, cid())).rejects.toMatchObject({ code: "ACCOUNT_IN_USE" });
  });

  it("lets only one of two simultaneous repayments of the whole remainder through", async () => {
    const advance = await grant(await newEmployee(), "500", "100");
    const results = await Promise.allSettled([repay(advance.id, "500"), repay(advance.id, "500")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["OVER_REPAYMENT", "NOTHING_TO_REPAY"]).toContain((failed.reason as SalaryAdvanceError).code);
    expect(await prisma.salaryAdvanceRepayment.count({ where: { salaryAdvanceId: advance.id } })).toBe(1);
  });

  it("validates the bank account and keeps companies apart", async () => {
    const advance = await grant(await newEmployee(), "200", "50");
    expect(await failsWith(repay(advance.id, "10", acc.revenue))).toBe("CASH_ACCOUNT_INVALID");
    expect(await failsWith(repay(advance.id, "10", newId()))).toBe("CASH_ACCOUNT_NOT_FOUND");
    expect(await failsWith(salaryAdvances.repay(advance.id, { repaymentDate: day, amount: "10", cashAccountId: acc.bank! }, outsider, cid(), newId()))).toBe("ADVANCE_NOT_FOUND");
    expect(await prisma.salaryAdvanceRepayment.count({ where: { salaryAdvanceId: advance.id } })).toBe(0);
  });

  it("lets payroll deduct only what remains after a repayment, never the full installment again", async () => {
    const employeeId = await newEmployee();
    const advance = await grant(employeeId, "1000", "600");
    await repay(advance.id, "700"); // 300 remains, the installment is 600

    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, actor, cid(), newId());
    const line = run.lines.find((l) => l.employeeId === employeeId)!;
    expect(line.advanceDeduction).toBe("300.0000");
    const after = (await salaryAdvances.listForEmployee(employeeId, companyId))[0]!;
    expect(after).toMatchObject({ deducted: "300.0000", repaid: "700.0000", remaining: "0.0000" });
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("refuses the end-of-service settlement while an advance is outstanding, and allows it once repaid", async () => {
    const employeeId = await newEmployee();
    const advance = await grant(employeeId, "900", "300");
    expect(await failsWith(endOfService.settle({ employeeId, terminationDate: day, reason: "RESIGNATION" }, actor, cid(), newId()))).toBe("OUTSTANDING_ADVANCES");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).isActive).toBe(true);

    await repay(advance.id, "900");
    const settled = await endOfService.settle({ employeeId, terminationDate: day, reason: "TERMINATION" }, actor, cid(), newId());
    expect(settled.number).toBeTruthy();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).isActive).toBe(false);
  });

  it("refuses stopping an employee by hand while an advance is outstanding", async () => {
    const employeeId = await newEmployee();
    const advance = await grant(employeeId, "300", "100");
    expect(await failsWith(employees.update(employeeId, { isActive: false }, actor, cid()))).toBe("OUTSTANDING_ADVANCES");
    await repay(advance.id, "300");
    expect((await employees.update(employeeId, { isActive: false }, actor, cid()))?.isActive).toBe(false);
  });

  it("still takes a repayment from an employee who is no longer active", async () => {
    const employeeId = await newEmployee();
    const advance = await grant(employeeId, "250", "50");
    await prisma.employee.update({ where: { id: employeeId }, data: { isActive: false } }); // a leaver from before this rule existed
    expect((await repay(advance.id, "250")).remaining).toBe("0.0000");
  });
});
