import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { GeneralLedgerService, LedgerAccountNotFoundError } from "./general-ledger.service.js";
import { PrismaNumberingService } from "./numbering.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped when DATABASE_URL is not set.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("general ledger statement — real database", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const ledger = new GeneralLedgerService(prisma);

  const year = new Date().getUTCFullYear();
  const day = (month: number, d: number): Date => new Date(Date.UTC(year, month - 1, d));

  let companyId: string;
  let periodId: string;
  let cash: string;
  let capital: string;

  function post(date: Date, lines: { accountId: string; debit?: string; credit?: string }[]): Promise<unknown> {
    return engine.postEntry({
      companyId,
      fiscalPeriodId: periodId,
      entryDate: date,
      postingDate: date,
      currency: "SAR",
      lines,
      sourceModule: "test",
      sourceDocumentType: "manual",
      sourceDocumentId: newId(),
      actorId: "test-actor",
      correlationId: newId(),
      idempotencyKey: newId(),
    });
  }

  beforeAll(async () => {
    companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: `Ledger Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        id: newId(),
        companyId,
        name: `FY${year}-${companyId.slice(0, 6)}`,
        startDate: day(1, 1),
        endDate: day(12, 31),
      },
    });
    periodId = (
      await prisma.fiscalPeriod.create({
        data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: day(1, 1), endDate: day(12, 31) },
      })
    ).id;

    const make = async (code: string, type: string, normalBalance: string): Promise<string> =>
      (
        await prisma.account.create({
          data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance },
        })
      ).id;
    cash = await make("1001", "ASSET", "DEBIT");
    capital = await make("3001", "EQUITY", "CREDIT");

    await post(day(1, 5), [
      { accountId: cash, debit: "1000.0000" },
      { accountId: capital, credit: "1000.0000" },
    ]);
    await post(day(2, 10), [
      { accountId: cash, credit: "250.2500" },
      { accountId: capital, debit: "250.2500" },
    ]);
    await post(day(2, 20), [
      { accountId: cash, debit: "40.0000" },
      { accountId: capital, credit: "40.0000" },
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("carries the earlier postings into the opening balance and runs the period", async () => {
    const result = await ledger.statement(companyId, cash, day(2, 1), day(2, 28));

    expect(result.openingBalance).toBe("1000.0000");
    expect(result.lines.map((l) => l.balance)).toEqual(["749.7500", "789.7500"]);
    expect(result.totalDebit).toBe("40.0000");
    expect(result.totalCredit).toBe("250.2500");
    expect(result.closingBalance).toBe("789.7500");
    expect(result.truncated).toBe(false);
  });

  it("shows a credit-normal account in its own direction", async () => {
    const result = await ledger.statement(companyId, capital, day(1, 1), day(12, 31));

    expect(result.normalBalance).toBe("CREDIT");
    expect(result.openingBalance).toBe("0.0000");
    expect(result.closingBalance).toBe("789.7500");
  });

  it("returns an empty period with the opening balance as the closing balance", async () => {
    const result = await ledger.statement(companyId, cash, day(6, 1), day(6, 30));

    expect(result.lines).toEqual([]);
    expect(result.openingBalance).toBe("789.7500");
    expect(result.closingBalance).toBe("789.7500");
  });

  it("does not reveal another company's account", async () => {
    await expect(ledger.statement(newId(), cash, day(1, 1), day(12, 31))).rejects.toBeInstanceOf(LedgerAccountNotFoundError);
  });
});
