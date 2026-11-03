import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { EmployeeService } from "./employee.service.js";
import { EndOfServiceService } from "./end-of-service.service.js";
import { HrPaymentError, HrPaymentService } from "./hr-payment.service.js";
import { PayrollRunService } from "./payroll-run.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("HR payments — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const employees = new EmployeeService(prisma, audit);
  const payrollRuns = new PayrollRunService(prisma, engine, mappings, audit);
  const endOfService = new EndOfServiceService(prisma, engine, mappings, audit);
  const payments = new HrPaymentService(prisma, engine, mappings, audit);

  const cid = (): string => newId();
  const day = new Date(Date.UTC(2026, 9, 18));
  const later = new Date(Date.UTC(2026, 9, 28));
  let counter = 0;

  async function company(withOwnAccounts: boolean) {
    const companyId = newId();
    const actor = { id: "hr-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `HR Payments ${companyId}`, defaultCurrency: "SAR" } });
    const fy = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY2026-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    const make = async (code: string, type: string, postable = true, parentId: string | null = null): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `T-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance: type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT", isPostable: postable, parentId } })).id;
    const acc: Record<string, string> = { bank: await make("1010", "ASSET"), bank2: await make("1020", "ASSET"), revenue: await make("4100", "REVENUE") };
    for (const [key, code, type] of [["SALARY_EXPENSE", "5100", "EXPENSE"], ["GOSI_EMPLOYER_EXPENSE", "5110", "EXPENSE"], ["GOSI_PAYABLE", "2110", "LIABILITY"], ["NET_PAY_PAYABLE", "2120", "LIABILITY"], ["SALARY_ADVANCES_RECEIVABLE", "1210", "ASSET"], ["EOSB_EXPENSE", "5120", "EXPENSE"], ["EOSB_PAYABLE", "2130", "LIABILITY"]] as const) {
      acc[key] = await make(code, type);
      await mappings.set(key, acc[key], actor, cid());
    }
    if (withOwnAccounts) {
      for (const [key, root, type] of [["EMPLOYEE_ADVANCES_PARENT", "7", "ASSET"], ["EMPLOYEE_SALARY_PAYABLE_PARENT", "8", "LIABILITY"], ["EMPLOYEE_EOSB_PARENT", "9", "LIABILITY"]] as const) {
        const r = await make(root, type, false);
        const g2 = await make(`${root}1`, type, false, r);
        const g3 = await make(`${root}1108`, type, false, g2);
        await mappings.set(key, g3, actor, cid());
      }
    }
    return { companyId, actor, acc };
  }

  type Tenant = Awaited<ReturnType<typeof company>>;
  const hire = (t: Tenant, name: string) =>
    employees.create({ name, nationalId: `33000${String(++counter).padStart(5, "0")}`, isSaudi: false, bankIban: "SA0380000000608010167519", hireDate: new Date(Date.UTC(2021, 0, 1)), basicSalary: "5000" }, t.actor, cid());
  async function balance(t: Tenant, accountId: string): Promise<number> {
    const row = (await trialBalance.compute(t.companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }
  const paySalaries = (t: Tenant, runId: string, extra: { employeeIds?: string[]; cash?: string; date?: Date } = {}) =>
    payments.paySalaries({ payrollRunId: runId, paymentDate: extra.date ?? later, cashAccountId: extra.cash ?? t.acc.bank!, ...(extra.employeeIds ? { employeeIds: extra.employeeIds } : {}) }, t.actor, cid(), newId());
  async function failsWith(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "no error";
    } catch (error) {
      if (error instanceof HrPaymentError) return error.code;
      throw error;
    }
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("pays a run's salaries: each employee's own account and the company-wide one go back to zero, the bank goes down by the same amount", async () => {
    const t = await company(true);
    const a = await hire(t, "Ahmad");
    const b = await hire(t, "Bushra");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const net = (id: string): number => Number(run.lines.find((l) => l.employeeId === id)!.net);
    expect(await balance(t, a.accounts!.salaryPayable.id)).toBeCloseTo(-net(a.id), 4);
    const bankBefore = await balance(t, t.acc.bank!);

    const paid = await paySalaries(t, run.id);
    expect(paid.number).toMatch(/^SPY-.*-000001$/);
    expect(Number(paid.amount)).toBeCloseTo(net(a.id) + net(b.id), 4);
    expect(await balance(t, a.accounts!.salaryPayable.id)).toBeCloseTo(0, 4);
    expect(await balance(t, b.accounts!.salaryPayable.id)).toBeCloseTo(0, 4);
    expect(await balance(t, t.acc.bank!)).toBeCloseTo(bankBefore - net(a.id) - net(b.id), 4);
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
    expect(await failsWith(paySalaries(t, run.id))).toBe("NOTHING_TO_PAY");
  });

  it("can pay some employees now and the rest later, and an employee without own accounts is paid from the company-wide one", async () => {
    const t = await company(false);
    const a = await hire(t, "Plain A");
    const b = await hire(t, "Plain B");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const netA = Number(run.lines.find((l) => l.employeeId === a.id)!.net);
    const netB = Number(run.lines.find((l) => l.employeeId === b.id)!.net);
    expect(await balance(t, t.acc.NET_PAY_PAYABLE!)).toBeCloseTo(-(netA + netB), 4);

    await paySalaries(t, run.id, { employeeIds: [a.id] });
    expect(await balance(t, t.acc.NET_PAY_PAYABLE!)).toBeCloseTo(-netB, 4);
    expect((await payments.payables(t.companyId)).runs[0]).toMatchObject({ unpaidCount: 1 });

    await paySalaries(t, run.id);
    expect(await balance(t, t.acc.NET_PAY_PAYABLE!)).toBeCloseTo(0, 4);
    expect((await payments.payables(t.companyId)).runs).toHaveLength(0);
  });

  it("lets only one of two simultaneous payments of the same run through", async () => {
    const t = await company(true);
    await hire(t, "Racer");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const results = await Promise.allSettled([paySalaries(t, run.id), paySalaries(t, run.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.hrPaymentItem.count({ where: { companyId: t.companyId } })).toBe(1);
  });

  it("refuses a bad bank account, a date before the run, another company's run", async () => {
    const t = await company(true);
    await hire(t, "Checked");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    expect(await failsWith(paySalaries(t, run.id, { cash: t.acc.revenue! }))).toBe("CASH_ACCOUNT_INVALID");
    expect(await failsWith(paySalaries(t, run.id, { cash: newId() }))).toBe("CASH_ACCOUNT_NOT_FOUND");
    expect(await failsWith(paySalaries(t, run.id, { date: new Date(Date.UTC(2026, 9, 1)) }))).toBe("BEFORE_SOURCE_DATE");
    const other = await company(false);
    expect(await failsWith(payments.paySalaries({ payrollRunId: run.id, paymentDate: later, cashAccountId: other.acc.bank! }, other.actor, cid(), newId()))).toBe("RUN_NOT_FOUND");
    expect(await prisma.hrPayment.count({ where: { companyId: t.companyId } })).toBe(0); // nothing was paid by the refused attempts
  });

  it("remits social insurance in parts and never more than is owed", async () => {
    const t = await company(true);
    await hire(t, "Insured");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const owed = Number(run.totalGosiEmployee) + Number(run.totalGosiEmployer);
    expect(owed).toBeGreaterThan(0);
    expect(Number((await payments.payables(t.companyId)).gosiOutstanding)).toBeCloseTo(owed, 4);
    expect(await balance(t, t.acc.GOSI_PAYABLE!)).toBeCloseTo(-owed, 4);

    const pay = (amount: string) => payments.payGosi({ amount, paymentDate: later, cashAccountId: t.acc.bank! }, t.actor, cid(), newId());
    await pay("10");
    expect(await balance(t, t.acc.GOSI_PAYABLE!)).toBeCloseTo(-owed + 10, 4);
    expect(await failsWith(pay(String(owed)))).toBe("OVER_PAYMENT");
    await pay((owed - 10).toFixed(4));
    expect(await balance(t, t.acc.GOSI_PAYABLE!)).toBeCloseTo(0, 4);
    expect(await failsWith(pay("1"))).toBe("NOTHING_TO_PAY");
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("pays an end-of-service gratuity once, from the employee's own account", async () => {
    const t = await company(true);
    const e = await hire(t, "Leaver");
    const settled = await endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "TERMINATION" }, t.actor, cid(), newId());
    const amount = Number(settled.netEntitlement);
    expect(amount).toBeGreaterThan(0);
    expect(await balance(t, e.accounts!.eosb.id)).toBeCloseTo(-amount, 4);
    expect((await payments.payables(t.companyId)).settlements).toHaveLength(1);

    const pay = () => payments.payEndOfService({ settlementId: settled.id, paymentDate: later, cashAccountId: t.acc.bank! }, t.actor, cid(), newId());
    const paid = await pay();
    expect(paid.number).toMatch(/^EPY-/);
    expect(await balance(t, e.accounts!.eosb.id)).toBeCloseTo(0, 4);
    expect(await failsWith(pay())).toBe("ALREADY_PAID");
    expect((await payments.payables(t.companyId)).settlements).toHaveLength(0);
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("lists and reads payments back, company-scoped", async () => {
    const t = await company(true);
    const e = await hire(t, "Listed");
    const run = await payrollRuns.create({ periodYear: 2026, periodMonth: 10, runDate: day }, t.actor, cid(), newId());
    const paid = await paySalaries(t, run.id);
    const page = await payments.list(t.companyId, {});
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ kind: "SALARY", payrollRunNumber: run.number });
    const detail = (await payments.get(paid.id, t.companyId))!;
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ employeeId: e.id });
    expect(await prisma.journalEntry.count({ where: { id: detail.journalEntryId, companyId: t.companyId } })).toBe(1);
    expect(await payments.get(paid.id, newId())).toBeNull();
    expect((await payments.list(newId(), {})).data).toHaveLength(0);
  });
});
