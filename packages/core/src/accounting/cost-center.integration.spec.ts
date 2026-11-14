import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { CostCenterService } from "./cost-center.service.js";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { PrismaNumberingService } from "./numbering.service.js";
import { CashExpenseService } from "../payments/cash-expense.service.js";
import { PrismaAuditLogger } from "../audit/audit-logger.js";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
describeIfDb("Cost center directory and expense allocation", () => {
  const prisma = new PrismaClient();
  const directory = new CostCenterService(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const expenses = new CashExpenseService(prisma, engine, new PrismaAuditLogger(prisma));
  const actor = { id: newId(), companyId: newId() };
  const other = { id: newId(), companyId: newId() };
  const date = new Date("2026-06-15T00:00:00Z");
  let cashId: string;
  let expenseId: string;
  const input = { code: "P1", name: "Project One", nameAr: "المشروع الأول", kind: "PROJECT" as const, isActive: true };
  beforeAll(async () => {
    for (const companyId of [actor.companyId, other.companyId]) await prisma.company.create({ data: { id: companyId, name: "Cost center test" } });
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId: actor.companyId, name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId: actor.companyId, fiscalYearId: year.id, periodNumber: 1, startDate: year.startDate, endDate: year.endDate } });
    cashId = (await prisma.account.create({ data: { id: newId(), companyId: actor.companyId, ref: newId(), code: "101", name: "Cash", type: "ASSET", normalBalance: "DEBIT" } })).id;
    expenseId = (await prisma.account.create({ data: { id: newId(), companyId: actor.companyId, ref: newId(), code: "501", name: "Expense", type: "EXPENSE", normalBalance: "DEBIT" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("scopes listing, duplicate codes and updates to the company", async () => {
    const center = await directory.save(input, actor, newId());
    await directory.save(input, other, newId());
    expect(await directory.list(actor.companyId)).toHaveLength(1);
    await expect(directory.save(input, actor, newId())).rejects.toMatchObject({ code: "COST_CENTER_DUPLICATE" });
    await expect(directory.save({ ...input, name: "Changed" }, other, newId(), center.id)).rejects.toMatchObject({ code: "COST_CENTER_NOT_FOUND" });
  });

  it("retains separate allocations to the same expense account and preserves them on reversal", async () => {
    const project = await directory.save({ ...input, code: "P2" }, actor, newId());
    const department = await directory.save({ ...input, code: "D1", kind: "DEPARTMENT" }, actor, newId());
    const result = await expenses.create({ expenseDate: date, cashAccountId: cashId, lines: [
      { expenseAccountId: expenseId, amount: "10.1234", costCenterId: project.id },
      { expenseAccountId: expenseId, amount: "20.4321", costCenterId: department.id },
    ] }, actor, newId(), newId());
    const saved = await prisma.cashExpense.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(saved.amount.toFixed(4)).toBe("30.5555");
    expect(saved.lines.map(line => line.costCenterId)).toEqual(expect.arrayContaining([project.id, department.id]));
    const posted = await prisma.journalEntryLine.findMany({ where: { journalEntryId: result.journalEntryId }, orderBy: { lineNumber: "asc" } });
    expect(posted.map(line => line.costCenterId)).toEqual([project.id, department.id, null]);
    await directory.save({ ...input, code: "P2", isActive: false }, actor, newId(), project.id);
    const reversed = await engine.reverseEntry(result.journalEntryId, "Test reversal", actor.id, newId());
    const reverseLines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: reversed.journalEntryId }, orderBy: { lineNumber: "asc" } });
    expect(reverseLines.map(line => [line.costCenterId, line.credit.toFixed(4)])).toEqual([[project.id, "10.1234"], [department.id, "20.4321"], [null, "0.0000"]]);
  });

  it("rejects inactive and foreign allocations without posting any document", async () => {
    const inactive = await directory.save({ ...input, code: "INACTIVE", isActive: false }, actor, newId());
    const foreign = await directory.save({ ...input, code: "FOREIGN" }, other, newId());
    const before = await prisma.cashExpense.count({ where: { companyId: actor.companyId } });
    for (const costCenterId of [inactive.id, foreign.id, newId()]) {
      await expect(expenses.create({ expenseDate: date, cashAccountId: cashId, lines: [{ expenseAccountId: expenseId, amount: "1", costCenterId }] }, actor, newId(), newId())).rejects.toMatchObject({ code: "COST_CENTER_INVALID" });
    }
    expect(await prisma.cashExpense.count({ where: { companyId: actor.companyId } })).toBe(before);
  });
});
