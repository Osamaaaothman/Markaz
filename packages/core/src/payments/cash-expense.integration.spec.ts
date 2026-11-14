import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { CashExpenseService } from "./cash-expense.service.js";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Cash expense lines and legacy rollout — real database", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const service = new CashExpenseService(prisma, engine, new PrismaAuditLogger(prisma));
  const companyId = newId();
  const actor = { id: "cash-expense-test", companyId };
  const today = new Date();
  let periodId: string;
  let cashId: string;
  let rentId: string;
  let travelId: string;

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: "Cash expense test", defaultCurrency: "SAR" } });
    const year = today.getUTCFullYear();
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    const fiscalYear = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: String(year), startDate, endDate } });
    periodId = (await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate, endDate } })).id;
    const account = async (code: string, type: string): Promise<string> => (await prisma.account.create({
      data: { id: newId(), companyId, ref: newId(), code, name: code, type, normalBalance: "DEBIT" },
    })).id;
    cashId = await account("1010", "ASSET");
    rentId = await account("5100", "EXPENSE");
    travelId = await account("5200", "EXPENSE");
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("posts exact debits by line, preserves cost centres and does not duplicate explicit lines", async () => {
    const result = await service.create({
      cashAccountId: cashId, expenseDate: today,
      lines: [
        { expenseAccountId: rentId, amount: "10.10", costCenterRef: "OFFICE" },
        { expenseAccountId: travelId, amount: "20.20", description: "Travel" },
      ],
    }, actor, newId(), newId());
    const row = await prisma.cashExpense.findFirstOrThrow({ where: { id: result.id, companyId }, include: { lines: true } });
    expect(row.amount.toFixed(4)).toBe("30.3000");
    expect(row.expenseAccountId).toBeNull();
    expect(row.lines).toHaveLength(2);
    expect(row.lines.find((line) => line.expenseAccountId === rentId)?.costCenterRef).toBe("OFFICE");
    const journal = await prisma.journalEntryLine.findMany({ where: { journalEntryId: result.journalEntryId, journalEntry: { companyId } } });
    expect(journal.map((line) => [line.accountId, line.debit.toFixed(4), line.credit.toFixed(4)]))
      .toEqual(expect.arrayContaining([[rentId, "10.1000", "0.0000"], [travelId, "20.2000", "0.0000"], [cashId, "0.0000", "30.3000"]]));
    expect((await new TrialBalanceService(prisma).compute(companyId)).isBalanced).toBe(true);
  });

  it("dual-writes a single account and does not add a second line at commit", async () => {
    const result = await service.create({ cashAccountId: cashId, expenseDate: today, lines: [{ expenseAccountId: rentId, amount: "1.25" }] }, actor, newId(), newId());
    const row = await prisma.cashExpense.findFirstOrThrow({ where: { id: result.id, companyId }, include: { lines: true } });
    expect(row.expenseAccountId).toBe(rentId);
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]!.amount.toFixed(4)).toBe("1.2500");
  });

  it("backfills an old API header inserted after migration at transaction commit", async () => {
    const id = newId();
    await prisma.$transaction(async (tx) => {
      const journal = await engine.postEntry({
        companyId, fiscalPeriodId: periodId, entryDate: today, postingDate: today, currency: "SAR",
        lines: [{ accountId: rentId, debit: "2.50" }, { accountId: cashId, credit: "2.50" }],
        sourceModule: "payments", sourceDocumentType: "cash_expense", sourceDocumentId: id,
        actorId: actor.id, correlationId: newId(), idempotencyKey: newId(),
      }, tx);
      await tx.cashExpense.create({ data: {
        id, companyId, number: `LEGACY-${id}`, expenseDate: today, amount: "2.50", currency: "SAR",
        cashAccountId: cashId, expenseAccountId: rentId, journalEntryId: journal.journalEntryId,
        actorId: actor.id, correlationId: newId(),
      } });
    });
    const lines = await prisma.cashExpenseLine.findMany({ where: { cashExpenseId: id, cashExpense: { companyId } } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.expenseAccountId).toBe(rentId);
    expect(lines[0]!.amount.toFixed(4)).toBe("2.5000");
  });
});
