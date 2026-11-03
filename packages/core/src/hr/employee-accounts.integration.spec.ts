import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { ChartOfAccountsService } from "../accounting/chart-of-accounts.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingError, AccountMappingService } from "../inventory/account-mapping.service.js";
import { EmployeeError, EmployeeService } from "./employee.service.js";
import { EndOfServiceService } from "./end-of-service.service.js";
import { PayrollRunService } from "./payroll-run.service.js";
import { SalaryAdvanceService } from "./salary-advance.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Employee accounts — real database", () => {
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

  const cid = (): string => newId();
  const day = new Date(Date.UTC(2026, 9, 18));
  let counter = 0;

  interface Tenant {
    readonly companyId: string;
    readonly actor: { id: string; companyId: string };
    readonly acc: Record<string, string>;
  }

  // A company with an open year, the company-wide payroll accounts mapped, and (optionally) the three parent groups.
  async function tenant(withParents: boolean): Promise<Tenant> {
    const companyId = newId();
    const actor = { id: "hr-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `Employee Accounts ${companyId}`, defaultCurrency: "SAR" } });
    const fy = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY2026-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    const make = async (code: string, name: string, type: string, parentId: string | null = null, isPostable = true): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `T-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance: type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT", parentId, isPostable } })).id;
    const acc: Record<string, string> = {
      bank: await make("1010", "Bank", "ASSET"),
      expense: await make("5100", "Salary expense", "EXPENSE"),
      gosiEmployerExpense: await make("5110", "GOSI employer expense", "EXPENSE"),
      gosiPayable: await make("2110", "GOSI payable", "LIABILITY"),
      netPay: await make("2120", "Net pay payable", "LIABILITY"),
      advances: await make("1210", "Salary advances receivable", "ASSET"),
      eosbExpense: await make("5120", "End-of-service expense", "EXPENSE"),
      eosbPayable: await make("2130", "End-of-service payable", "LIABILITY"),
    };
    for (const [key, id] of [["SALARY_EXPENSE", acc.expense], ["GOSI_EMPLOYER_EXPENSE", acc.gosiEmployerExpense], ["GOSI_PAYABLE", acc.gosiPayable], ["NET_PAY_PAYABLE", acc.netPay], ["SALARY_ADVANCES_RECEIVABLE", acc.advances], ["EOSB_EXPENSE", acc.eosbExpense], ["EOSB_PAYABLE", acc.eosbPayable]] as const) {
      await mappings.set(key, id!, actor, cid());
    }
    if (withParents) await setParents(companyId, actor, acc);
    return { companyId, actor, acc };
  }

  // Three group accounts on the usual chart shape: level-1 root, level-2 group, level-3 group the employee accounts sit under.
  async function setParents(companyId: string, actor: { id: string; companyId: string }, acc: Record<string, string>): Promise<void> {
    const group = async (root: string, type: string, name: string): Promise<string> => {
      const r = await prisma.account.create({ data: { id: newId(), ref: `T-${root}-${companyId.slice(0, 6)}`, companyId, code: root, name: `${name} root`, type, normalBalance: type === "ASSET" ? "DEBIT" : "CREDIT", isPostable: false } });
      const g2 = await prisma.account.create({ data: { id: newId(), ref: `T-${root}1-${companyId.slice(0, 6)}`, companyId, code: `${root}1`, name: `${name} level 2`, type, normalBalance: type === "ASSET" ? "DEBIT" : "CREDIT", parentId: r.id, isPostable: false } });
      const g3 = await prisma.account.create({ data: { id: newId(), ref: `T-${root}108-${companyId.slice(0, 6)}`, companyId, code: `${root}1108`, name, type, normalBalance: type === "ASSET" ? "DEBIT" : "CREDIT", parentId: g2.id, isPostable: false } });
      return g3.id;
    };
    // Roots 7, 8, 9 are free of the postable test codes above.
    acc.advancesGroup = await group("7", "ASSET", "Employee advances");
    acc.salaryGroup = await group("8", "LIABILITY", "Employee salaries payable");
    acc.eosbGroup = await group("9", "LIABILITY", "Employee end of service payable");
    await mappings.set("EMPLOYEE_ADVANCES_PARENT", acc.advancesGroup, actor, cid());
    await mappings.set("EMPLOYEE_SALARY_PAYABLE_PARENT", acc.salaryGroup, actor, cid());
    await mappings.set("EMPLOYEE_EOSB_PARENT", acc.eosbGroup, actor, cid());
  }

  const newEmployee = async (t: Tenant, name = `Employee ${++counter}`) =>
    employees.create(
      { name, nameAr: `موظف ${counter}`, nationalId: `31000${String(++counter).padStart(5, "0")}`, isSaudi: false, bankIban: "SA0380000000608010167519", hireDate: new Date(Date.UTC(2021, 0, 1)), basicSalary: "5000" },
      t.actor,
      cid(),
    );

  async function balance(t: Tenant, accountId: string): Promise<number> {
    const row = (await trialBalance.compute(t.companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  async function failsWith(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "no error";
    } catch (error) {
      if (error instanceof EmployeeError) return error.code;
      if (error instanceof AccountMappingError) return error.code;
      throw error;
    }
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an employee without accounts when the three groups are not set (company-wide accounts keep being used)", async () => {
    const t = await tenant(false);
    const e = await newEmployee(t);
    expect(e.accounts).toBeNull();
    expect(await prisma.party.count({ where: { companyId: t.companyId } })).toBe(0);
  });

  it("refuses to create an employee when only some of the three groups are set, and creates nothing", async () => {
    const t = await tenant(false);
    const g = await prisma.account.create({ data: { id: newId(), ref: `T-P-${t.companyId.slice(0, 6)}`, companyId: t.companyId, code: "7", name: "Advances group", type: "ASSET", normalBalance: "DEBIT", isPostable: false } });
    await mappings.set("EMPLOYEE_ADVANCES_PARENT", g.id, t.actor, cid());
    expect(await failsWith(newEmployee(t))).toBe("ACCOUNTS_PARENTS_INCOMPLETE");
    expect(await prisma.employee.count({ where: { companyId: t.companyId } })).toBe(0);
    expect(await prisma.party.count({ where: { companyId: t.companyId } })).toBe(0);
    expect(await prisma.account.count({ where: { companyId: t.companyId, parentId: g.id } })).toBe(0);
  });

  it("only maps a group of the right type to a group key, and only a postable account to the other keys", async () => {
    const t = await tenant(false);
    expect(await failsWith(mappings.set("EMPLOYEE_ADVANCES_PARENT", t.acc.advances!, t.actor, cid()))).toBe("ACCOUNT_NOT_GROUP");
    const liabilityGroup = await prisma.account.create({ data: { id: newId(), ref: `T-LG-${t.companyId.slice(0, 6)}`, companyId: t.companyId, code: "8", name: "Liab group", type: "LIABILITY", normalBalance: "CREDIT", isPostable: false } });
    expect(await failsWith(mappings.set("EMPLOYEE_ADVANCES_PARENT", liabilityGroup.id, t.actor, cid()))).toBe("ACCOUNT_WRONG_TYPE");
    expect(await failsWith(mappings.set("NET_PAY_PAYABLE", liabilityGroup.id, t.actor, cid()))).toBe("ACCOUNT_NOT_POSTABLE");
  });

  it("gives a new employee a party and three accounts under the mapped groups, numbered by the chart's own rule", async () => {
    const t = await tenant(true);
    const first = await newEmployee(t, "Layla");
    const second = await newEmployee(t, "Omar");

    const a = first.accounts!;
    expect(a.advance.code).toBe("7110801");
    expect(a.salaryPayable.code).toBe("8110801");
    expect(a.eosb.code).toBe("9110801");
    expect(second.accounts!.advance.code).toBe("7110802");
    // The third account is the employee's dues (what is owed to them besides salary).
    expect(a.eosb.name).toBe("Employee dues - Layla");
    expect(a.eosb.nameAr).toMatch(/^مستحقات - /);

    const rows = await prisma.account.findMany({ where: { id: { in: [a.advance.id, a.salaryPayable.id, a.eosb.id] } } });
    expect(rows.map((r) => [r.type, r.normalBalance, r.isPostable, r.partyId])).toEqual(
      expect.arrayContaining([["ASSET", "DEBIT", true, a.partyId], ["LIABILITY", "CREDIT", true, a.partyId]]),
    );
    expect(rows.every((r) => r.partyId === a.partyId)).toBe(true);
    expect(rows.find((r) => r.id === a.advance.id)!.parentId).toBe(t.acc.advancesGroup);
    const party = await prisma.party.findUniqueOrThrow({ where: { id: a.partyId } });
    expect(party).toMatchObject({ kind: "EMPLOYEE", name: "Layla", companyId: t.companyId });
    expect(await prisma.auditLog.count({ where: { entityId: a.advance.id, action: "account.created" } })).toBe(1);
  });

  it("gives simultaneous new employees different account codes and loses none", async () => {
    const t = await tenant(true);
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => newEmployee(t, `Parallel ${i}`)));
    const codes = created.flatMap((e) => [e.accounts!.advance.code, e.accounts!.salaryPayable.code, e.accounts!.eosb.code]);
    expect(new Set(codes).size).toBe(18);
  });

  it("posts payroll per employee: net pay on the employee's own account, a legacy employee on the company-wide one", async () => {
    const t = await tenant(false);
    const legacy = await newEmployee(t, "Legacy");
    await setParents(t.companyId, t.actor, t.acc);
    const own = await newEmployee(t, "Modern");

    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const net = (id: string): number => Number(run.lines.find((l) => l.employeeId === id)!.net);
    expect(await balance(t, own.accounts!.salaryPayable.id)).toBeCloseTo(-net(own.id), 4);
    expect(await balance(t, t.acc.netPay!)).toBeCloseTo(-net(legacy.id), 4);
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("keeps an advance on the account it was granted on: own account for a provisioned employee, company-wide for an older one", async () => {
    const t = await tenant(false);
    const legacy = await newEmployee(t, "Old advance");
    const grantTo = (employeeId: string, amount: string) => salaryAdvances.grant({ employeeId, grantDate: day, amount, installmentAmount: "100", cashAccountId: t.acc.bank! }, t.actor, cid(), newId());

    const oldAdvance = await grantTo(legacy.id, "600");
    await setParents(t.companyId, t.actor, t.acc);
    await employees.provisionAccounts(legacy.id, t.actor, cid()); // now has accounts, but the advance above was granted before
    const modern = await newEmployee(t, "New advance");
    const newAdvance = await grantTo(modern.id, "400");

    expect(await balance(t, t.acc.advances!)).toBeCloseTo(600, 4);
    expect(await balance(t, modern.accounts!.advance.id)).toBeCloseTo(400, 4);

    await salaryAdvances.repay(oldAdvance.id, { repaymentDate: day, amount: "200", cashAccountId: t.acc.bank! }, t.actor, cid(), newId());
    await salaryAdvances.repay(newAdvance.id, { repaymentDate: day, amount: "150", cashAccountId: t.acc.bank! }, t.actor, cid(), newId());
    expect(await balance(t, t.acc.advances!)).toBeCloseTo(400, 4);
    expect(await balance(t, modern.accounts!.advance.id)).toBeCloseTo(250, 4);

    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 9, runDate: new Date(Date.UTC(2026, 8, 28)) }, t.actor, cid(), newId());
    expect(Number(run.lines.find((l) => l.employeeId === legacy.id)!.advanceDeduction)).toBe(100);
    expect(await balance(t, t.acc.advances!)).toBeCloseTo(300, 4); // 600 - 200 - 100 deducted, still company-wide
    expect(await balance(t, modern.accounts!.advance.id)).toBeCloseTo(150, 4); // 400 - 150 - 100 deducted
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("credits the end-of-service gratuity to the employee's own account", async () => {
    const t = await tenant(true);
    const e = await newEmployee(t, "Leaving");
    const settled = await endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "TERMINATION" }, t.actor, cid(), newId());
    expect(Number(settled.netEntitlement)).toBeGreaterThan(0);
    expect(await balance(t, e.accounts!.eosb.id)).toBeCloseTo(-Number(settled.netEntitlement), 4);
    expect(await balance(t, t.acc.eosbPayable!)).toBe(0);
  });

  it("adds the missing party and accounts to an existing employee, once, without touching what is posted", async () => {
    const t = await tenant(false);
    const e = await newEmployee(t, "Backfill");
    expect(await failsWith(employees.provisionAccounts(e.id, t.actor, cid()))).toBe("ACCOUNTS_PARENTS_NOT_MAPPED");

    await setParents(t.companyId, t.actor, t.acc);
    const done = await employees.provisionAccounts(e.id, t.actor, cid());
    expect(done!.accounts!.advance.code).toBe("7110801");
    const accountsBefore = await prisma.account.count({ where: { companyId: t.companyId } });
    const again = await employees.provisionAccounts(e.id, t.actor, cid());
    expect(again!.accounts!.partyId).toBe(done!.accounts!.partyId);
    expect(await prisma.account.count({ where: { companyId: t.companyId } })).toBe(accountsBefore);
    expect(await prisma.party.count({ where: { companyId: t.companyId, kind: "EMPLOYEE" } })).toBe(1);

    await newEmployee(t); // already complete: not counted
    const bulkTenant = await tenant(false);
    await newEmployee(bulkTenant);
    await newEmployee(bulkTenant);
    await setParents(bulkTenant.companyId, bulkTenant.actor, bulkTenant.acc);
    expect(await employees.provisionMissingAccounts(bulkTenant.actor, cid())).toEqual({ provisioned: 2, failed: [] });
    expect(await employees.provisionMissingAccounts(bulkTenant.actor, cid())).toEqual({ provisioned: 0, failed: [] });
  });

  it("never touches another company's employee", async () => {
    const mine = await tenant(true);
    const theirs = await tenant(false);
    const stranger = await newEmployee(theirs, "Stranger");
    expect(await employees.provisionAccounts(stranger.id, mine.actor, cid())).toBeNull();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: stranger.id } })).advanceAccountId).toBeNull();
  });

  it("counts an employee's account as in use, so it cannot be deleted", async () => {
    const t = await tenant(true);
    const e = await newEmployee(t, "Protected");
    const usage = await chart.usage(e.accounts!.advance.id, t.actor);
    expect(usage.usage.employeeAccounts).toBe(1);
    expect(usage.canDelete).toBe(false);
    await expect(chart.delete(e.accounts!.advance.id, t.actor, cid())).rejects.toMatchObject({ code: "ACCOUNT_IN_USE" });
  });
});
