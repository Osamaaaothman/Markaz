import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { EmployeeService } from "./employee.service.js";
import { EndOfServiceService } from "./end-of-service.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("End-of-service settlement — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const employees = new EmployeeService(prisma, audit);
  const endOfService = new EndOfServiceService(prisma, engine, mappings, audit);

  const cid = (): string => newId();
  const day = new Date(Date.UTC(2026, 9, 18));
  let counter = 0;

  interface Tenant {
    readonly companyId: string;
    readonly actor: { id: string; companyId: string };
    readonly expenseId: string;
    readonly payableId: string;
  }

  // A company with an open year and the two end-of-service accounts mapped (no per-employee accounts).
  async function tenant(): Promise<Tenant> {
    const companyId = newId();
    const actor = { id: "hr-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `End of service ${companyId}`, defaultCurrency: "SAR" } });
    const fy = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY2026-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: new Date(Date.UTC(2026, 0, 1)), endDate: new Date(Date.UTC(2026, 11, 31)) } });
    const make = async (code: string, type: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `T-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance: type === "EXPENSE" ? "DEBIT" : "CREDIT", isPostable: true } })).id;
    const expenseId = await make("5120", "EXPENSE");
    const payableId = await make("2130", "LIABILITY");
    await mappings.set("EOSB_EXPENSE", expenseId, actor, cid());
    await mappings.set("EOSB_PAYABLE", payableId, actor, cid());
    return { companyId, actor, expenseId, payableId };
  }

  const newEmployee = async (t: Tenant, hireDate: Date, name = `Employee ${++counter}`) =>
    employees.create(
      { name, nationalId: `31000${String(++counter).padStart(5, "0")}`, isSaudi: false, bankIban: "SA0380000000608010167519", hireDate, basicSalary: "5000" },
      t.actor,
      cid(),
    );

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("settles a resignation under two years with nothing owed: the employee is terminated, a settlement is recorded and no journal entry is posted", async () => {
    // Arrange: hired the day they leave, so a resignation entitles them to nothing.
    const t = await tenant();
    const e = await newEmployee(t, day);

    // Act
    const result = await endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "RESIGNATION" }, t.actor, cid(), newId());

    // Assert
    expect(Number(result.netEntitlement)).toBe(0);
    expect(result.journalEntryId).toBeNull();
    expect(result.number).toMatch(/^EOS/);

    const settlement = await prisma.endOfServiceSettlement.findFirstOrThrow({ where: { id: result.id, companyId: t.companyId } });
    expect(settlement.journalEntryId).toBeNull();
    expect(settlement.reason).toBe("RESIGNATION");
    expect(settlement.netEntitlement.toFixed(4)).toBe("0.0000");

    const employee = await prisma.employee.findFirstOrThrow({ where: { id: e.id, companyId: t.companyId } });
    expect(employee.isActive).toBe(false);
    expect(employee.terminationDate?.getTime()).toBe(day.getTime());

    expect(await prisma.journalEntry.count({ where: { companyId: t.companyId } })).toBe(0);
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("refuses to settle the same employee twice after a zero settlement", async () => {
    const t = await tenant();
    const e = await newEmployee(t, day);
    await endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "RESIGNATION" }, t.actor, cid(), newId());

    await expect(endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "RESIGNATION" }, t.actor, cid(), newId())).rejects.toMatchObject({ code: "ALREADY_TERMINATED" });
    expect(await prisma.endOfServiceSettlement.count({ where: { companyId: t.companyId } })).toBe(1);
  });

  it("still accrues the gratuity when something is owed: Dr expense, Cr payable, linked to the settlement", async () => {
    const t = await tenant();
    const e = await newEmployee(t, new Date(Date.UTC(2021, 0, 1)));

    const result = await endOfService.settle({ employeeId: e.id, terminationDate: day, reason: "TERMINATION" }, t.actor, cid(), newId());

    const owed = Number(result.netEntitlement);
    expect(owed).toBeGreaterThan(0);
    expect(result.journalEntryId).not.toBeNull();
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: result.journalEntryId! } });
    expect(lines).toHaveLength(2);
    expect(Number(lines.find((l) => l.accountId === t.expenseId)?.debit)).toBe(owed);
    expect(Number(lines.find((l) => l.accountId === t.payableId)?.credit)).toBe(owed);
    expect((await prisma.endOfServiceSettlement.findFirstOrThrow({ where: { id: result.id } })).journalEntryId).toBe(result.journalEntryId);
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
  });

  it("rejects, in the database, a settlement that owes money but has no journal entry", async () => {
    const t = await tenant();
    const e = await newEmployee(t, day);

    // Raw insert on purpose: the service never produces this row, so the constraint is tested directly.
    const insertOwedWithoutEntry = prisma.$executeRaw`
      INSERT INTO end_of_service_settlements
        (id, company_id, employee_id, number, termination_date, reason, years_of_service, gross_entitlement, entitlement_fraction, net_entitlement, journal_entry_id, actor_id, correlation_id)
      VALUES (${newId()}, ${t.companyId}, ${e.id}, ${"EOS-CHECK-1"}, ${day}, ${"TERMINATION"}, 5, 100, 1, 100, NULL, ${t.actor.id}, ${cid()})`;

    await expect(insertOwedWithoutEntry).rejects.toThrow(/end_of_service_settlements_journal_entry_check/);
  });
});
