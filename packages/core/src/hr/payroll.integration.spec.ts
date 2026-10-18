import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { EmployeeService } from "./employee.service.js";
import { EndOfServiceError, EndOfServiceService } from "./end-of-service.service.js";
import { PayrollRunError, PayrollRunService } from "./payroll-run.service.js";
import { SalaryAdvanceService } from "./salary-advance.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Payroll — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const employees = new EmployeeService(prisma, audit);
  const payrollRuns = new PayrollRunService(prisma, engine, mappings, audit);
  const salaryAdvances = new SalaryAdvanceService(prisma, engine, mappings, audit);
  const endOfService = new EndOfServiceService(prisma, engine, mappings, audit);

  const companyId = newId();
  const actor = { id: "payroll-clerk", companyId };
  const cid = (): string => newId();
  const runDate = new Date(Date.UTC(2026, 9, 18)); // 18 Oct 2026 -- the GOSI 20% bracket

  let acc: Record<string, string>;
  let saudiEmployeeId: string;
  let expatEmployeeId: string;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Payroll Test ${companyId}`, defaultCurrency: "SAR" } });
    const year = 2026;
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance, isPostable: true } })).id;
    acc = {
      bank: await make("1010", "Bank", "ASSET", "DEBIT"),
      salaryExpense: await make("5100", "Salary expense", "EXPENSE", "DEBIT"),
      gosiEmployerExpense: await make("5110", "GOSI employer expense", "EXPENSE", "DEBIT"),
      gosiPayable: await make("2110", "GOSI payable", "LIABILITY", "CREDIT"),
      netPayPayable: await make("2120", "Net pay payable", "LIABILITY", "CREDIT"),
      advancesReceivable: await make("1210", "Salary advances receivable", "ASSET", "DEBIT"),
      eosbExpense: await make("5120", "End-of-service expense", "EXPENSE", "DEBIT"),
      eosbPayable: await make("2130", "End-of-service payable", "LIABILITY", "CREDIT"),
    };
    await mappings.set("SALARY_EXPENSE", acc.salaryExpense!, actor, cid());
    await mappings.set("GOSI_EMPLOYER_EXPENSE", acc.gosiEmployerExpense!, actor, cid());
    await mappings.set("GOSI_PAYABLE", acc.gosiPayable!, actor, cid());
    await mappings.set("NET_PAY_PAYABLE", acc.netPayPayable!, actor, cid());
    await mappings.set("SALARY_ADVANCES_RECEIVABLE", acc.advancesReceivable!, actor, cid());
    await mappings.set("EOSB_EXPENSE", acc.eosbExpense!, actor, cid());
    await mappings.set("EOSB_PAYABLE", acc.eosbPayable!, actor, cid());

    saudiEmployeeId = (
      await employees.create(
        { name: "Saudi Employee", nationalId: "1111111111", isSaudi: true, bankIban: "SA0000000000000000000001", hireDate: new Date(Date.UTC(2020, 0, 1)), basicSalary: "6000", housingAllowance: "1500" },
        actor,
        cid(),
      )
    ).id;
    expatEmployeeId = (
      await employees.create(
        { name: "Expat Employee", nationalId: "2222222222", isSaudi: false, bankIban: "SA0000000000000000000002", hireDate: new Date(Date.UTC(2021, 0, 1)), basicSalary: "5000", housingAllowance: "1000" },
        actor,
        cid(),
      )
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs payroll for a mixed Saudi/expatriate roster, posts one balanced entry and computes GOSI per the confirmed law", async () => {
    const result = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate }, actor, cid(), newId());

    expect(result.lines).toHaveLength(2);
    const saudiLine = result.lines.find((l) => l.employeeId === saudiEmployeeId)!;
    const expatLine = result.lines.find((l) => l.employeeId === expatEmployeeId)!;

    // Saudi: base 7500, 20% pension bracket today -> 750 each side; hazards 150 (employer);
    // SANED 75 each. Employee share 825, employer share 975.
    expect(saudiLine.gosiEmployeeShare).toBe("825.0000");
    expect(saudiLine.gosiEmployerShare).toBe("975.0000");
    expect(saudiLine.net).toBe((7500 - 825).toFixed(4));

    // Expatriate: base 6000, 2% hazards only, employer-borne.
    expect(expatLine.gosiEmployeeShare).toBe("0.0000");
    expect(expatLine.gosiEmployerShare).toBe("120.0000");
    expect(expatLine.net).toBe("6000.0000");

    expect(result.totalGross).toBe("13500.0000"); // 7500 + 6000
    expect(result.totalGosiEmployee).toBe("825.0000");
    expect(result.totalGosiEmployer).toBe((975 + 120).toFixed(4));

    // The ledger balances: salary expense + employer GOSI expense == GOSI payable + net pay payable.
    expect(await balance(acc.salaryExpense!)).toBeCloseTo(13500, 4);
    expect(await balance(acc.gosiEmployerExpense!)).toBeCloseTo(975 + 120, 4);
    expect(await balance(acc.gosiPayable!)).toBeCloseTo(-(825 + 975 + 120), 4);
    expect(await balance(acc.netPayPayable!)).toBeCloseTo(-(13500 - 825), 4);
  });

  it("refuses a second run for the same period", async () => {
    await expect(payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate }, actor, cid(), newId())).rejects.toThrow(PayrollRunError);
  });

  it("grants a salary advance and deducts it automatically from the next run", async () => {
    const advance = await salaryAdvances.grant(
      { employeeId: saudiEmployeeId, grantDate: runDate, amount: "1000", installmentAmount: "400", cashAccountId: acc.bank! },
      actor,
      cid(),
      newId(),
    );
    expect(advance.number).toMatch(/^ADV-/);
    expect(await balance(acc.advancesReceivable!)).toBeCloseTo(1000, 4);

    const nextRunDate = new Date(Date.UTC(2026, 10, 18));
    const nextRun = await payrollRuns.create({ periodYear: 2026, periodMonth: 11, runDate: nextRunDate }, actor, cid(), newId());
    const saudiLine = nextRun.lines.find((l) => l.employeeId === saudiEmployeeId)!;
    expect(saudiLine.advanceDeduction).toBe("400.0000");
    expect(await balance(acc.advancesReceivable!)).toBeCloseTo(1000 - 400, 4);

    const advances = await salaryAdvances.listForEmployee(saudiEmployeeId, companyId);
    expect(advances[0]!.remaining).toBe("600.0000");
  });

  it("settles an employee's exit, accrues the gratuity and deactivates them", async () => {
    // Hired 2021-01-01, terminated here (2026-10-18) by the employer -> full entitlement, not reduced.
    const result = await endOfService.settle({ employeeId: expatEmployeeId, terminationDate: runDate, reason: "TERMINATION" }, actor, cid(), newId());

    expect(result.number).toMatch(/^EOS-/);
    expect(result.entitlementFraction).toBe("1.0000");
    // ~5.8 years: 5*0.5*6000 + 0.8*6000 ~= 19800 (base = basic+housing+other = 5000+1000+0 = 6000)
    expect(Number(result.netEntitlement)).toBeGreaterThan(19000);
    expect(Number(result.netEntitlement)).toBeLessThan(21000);
    expect(await balance(acc.eosbPayable!)).toBeCloseTo(-Number(result.netEntitlement), 2);

    const after = await employees.get(expatEmployeeId, companyId);
    expect(after!.isActive).toBe(false);
    expect(after!.terminationDate).toBe("2026-10-18");
  });

  it("refuses to settle the same employee twice", async () => {
    await expect(endOfService.settle({ employeeId: expatEmployeeId, terminationDate: runDate, reason: "TERMINATION" }, actor, cid(), newId())).rejects.toThrow(EndOfServiceError);
  });

  it("never shows another company's employees or payroll runs", async () => {
    const other = newId();
    await prisma.company.create({ data: { id: other, name: `Other ${other}`, defaultCurrency: "SAR" } });
    expect(await employees.listAllActive(other)).toEqual([]);
    expect(await payrollRuns.list(other)).toEqual([]);
  });
});
