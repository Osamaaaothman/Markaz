import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { PrismaNumberingService } from "./numbering.service.js";
import { TrialBalanceService, buildPeriodTrialBalance, splitNetBalance } from "./trial-balance.service.js";

describe("splitNetBalance", () => {
  it("puts a positive net on the debit side, a negative net on the credit side, zero on neither", () => {
    expect(splitNetBalance(250000n)).toEqual({ debit: 250000n, credit: 0n });
    expect(splitNetBalance(-250000n)).toEqual({ debit: 0n, credit: 250000n });
    expect(splitNetBalance(0n)).toEqual({ debit: 0n, credit: 0n });
  });
});

describe("buildPeriodTrialBalance", () => {
  const row = (code: string, openingNet: string, movementDebit: string, movementCredit: string) => ({
    accountId: `id-${code}`,
    accountCode: code,
    accountName: `Account ${code}`,
    accountType: "ASSET",
    openingNet,
    movementDebit,
    movementCredit,
  });

  it("derives opening, movement and closing and balances every pair of columns", () => {
    const result = buildPeriodTrialBalance(
      [row("1000", "100.0000", "50.0000", "20.0000"), row("2000", "-100.0000", "20.0000", "50.0000")],
      "2026-01-01",
      "2026-12-31",
    );
    expect(result.lines[0]).toMatchObject({ openingDebit: "100.0000", openingCredit: "0.0000", movementDebit: "50.0000", movementCredit: "20.0000", closingDebit: "130.0000", closingCredit: "0.0000" });
    expect(result.lines[1]).toMatchObject({ openingDebit: "0.0000", openingCredit: "100.0000", closingDebit: "0.0000", closingCredit: "130.0000" });
    expect(result.totals).toEqual({ openingDebit: "100.0000", openingCredit: "100.0000", movementDebit: "70.0000", movementCredit: "70.0000", closingDebit: "130.0000", closingCredit: "130.0000" });
    expect(result.isBalanced).toBe(true);
  });

  it("shows an account that is paid off inside the period with a zero closing balance, and drops one with no activity", () => {
    const result = buildPeriodTrialBalance([row("1000", "100.0000", "0.0000", "100.0000"), row("9999", "0.0000", "0.0000", "0.0000")], "2026-01-01", "2026-12-31");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ closingDebit: "0.0000", closingCredit: "0.0000", movementCredit: "100.0000" });
  });

  it("reports an out-of-balance ledger instead of hiding it", () => {
    const result = buildPeriodTrialBalance([row("1000", "0.0000", "10.0000", "0.0000")], "2026-01-01", "2026-12-31");
    expect(result.isBalanced).toBe(false);
  });
});

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("TrialBalanceService.computeForPeriod — real database", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const service = new TrialBalanceService(prisma);
  const companyId = newId();
  const other = newId();
  let periodId: string;
  let cash: string;
  let sales: string;

  const post = (entryDate: Date, amount: string) =>
    engine.postEntry({
      companyId,
      fiscalPeriodId: periodId,
      entryDate,
      postingDate: new Date(),
      currency: "SAR",
      lines: [
        { accountId: cash, debit: amount },
        { accountId: sales, credit: amount },
      ],
      sourceModule: "test",
      sourceDocumentType: "period_test",
      sourceDocumentId: newId(),
      actorId: "test-actor",
      correlationId: newId(),
      idempotencyKey: newId(),
    });

  beforeAll(async () => {
    for (const id of [companyId, other]) await prisma.company.create({ data: { id, name: `Period TB ${id}`, defaultCurrency: "SAR" } });
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(2030, 0, 1)), endDate: new Date(Date.UTC(2030, 11, 31)) } });
    periodId = (await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: year.id, periodNumber: 1, startDate: new Date(Date.UTC(2030, 0, 1)), endDate: new Date(Date.UTC(2030, 11, 31)) } })).id;
    cash = (await prisma.account.create({ data: { id: newId(), ref: `TB-C-${companyId.slice(0, 6)}`, companyId, code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" } })).id;
    sales = (await prisma.account.create({ data: { id: newId(), ref: `TB-S-${companyId.slice(0, 6)}`, companyId, code: "4000", name: "Sales", type: "REVENUE", normalBalance: "CREDIT" } })).id;
    await post(new Date(Date.UTC(2030, 0, 10)), "100.00"); // before the period below
    await post(new Date(Date.UTC(2030, 1, 10)), "40.00"); // inside
    await post(new Date(Date.UTC(2030, 2, 10)), "7.00"); // after
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("splits entries by date into opening, movement and closing, and ignores later ones", async () => {
    const result = await service.computeForPeriod(companyId, new Date(Date.UTC(2030, 1, 1)), new Date(Date.UTC(2030, 1, 28)));
    const cashLine = result.lines.find((l) => l.accountCode === "1000");
    const salesLine = result.lines.find((l) => l.accountCode === "4000");

    expect(cashLine).toMatchObject({ openingDebit: "100.0000", openingCredit: "0.0000", movementDebit: "40.0000", movementCredit: "0.0000", closingDebit: "140.0000", closingCredit: "0.0000" });
    expect(salesLine).toMatchObject({ openingDebit: "0.0000", openingCredit: "100.0000", movementDebit: "0.0000", movementCredit: "40.0000", closingDebit: "0.0000", closingCredit: "140.0000" });
    expect(result.isBalanced).toBe(true);
    expect(result.from).toBe("2030-02-01");
    expect(result.to).toBe("2030-02-28");
  });

  it("includes both end dates, and a period with no entries has an opening balance but no movement", async () => {
    const edge = await service.computeForPeriod(companyId, new Date(Date.UTC(2030, 1, 10)), new Date(Date.UTC(2030, 1, 10)));
    expect(edge.lines.find((l) => l.accountCode === "1000")).toMatchObject({ movementDebit: "40.0000" });

    const quiet = await service.computeForPeriod(companyId, new Date(Date.UTC(2030, 5, 1)), new Date(Date.UTC(2030, 5, 30)));
    expect(quiet.lines.find((l) => l.accountCode === "1000")).toMatchObject({ openingDebit: "147.0000", movementDebit: "0.0000", closingDebit: "147.0000" });
  });

  it("never shows another company's accounts", async () => {
    const result = await service.computeForPeriod(other, new Date(Date.UTC(2030, 0, 1)), new Date(Date.UTC(2030, 11, 31)));
    expect(result.lines).toEqual([]);
    expect(result.isBalanced).toBe(true);
  });
});
