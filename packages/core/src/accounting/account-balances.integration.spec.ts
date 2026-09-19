import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { AccountBalancesService } from "./account-balances.service.js";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { PrismaNumberingService } from "./numbering.service.js";

// Real PostgreSQL, like ledger-integrity.integration.spec.ts (docs/10-TESTING-RULES.md §1);
// skipped when DATABASE_URL (the erp_app runtime role, migrated database) is not set.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("account balances roll-up — real database", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const balances = new AccountBalancesService(prisma);

  let companyId: string;
  let periodId: string;
  let group: string;
  let leafA: string;
  let leafB: string;
  let equity: string;
  let secondEntryId: string;

  const today = new Date();

  function post(lines: { accountId: string; debit?: string; credit?: string }[]): Promise<{ journalEntryId: string }> {
    return engine.postEntry({
      companyId,
      fiscalPeriodId: periodId,
      entryDate: today,
      postingDate: today,
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
    await prisma.company.create({
      data: { id: companyId, name: `Balances Test ${companyId}`, defaultCurrency: "SAR" },
    });
    const year = today.getUTCFullYear();
    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        id: newId(),
        companyId,
        name: `FY${year}-${companyId.slice(0, 6)}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
    periodId = (
      await prisma.fiscalPeriod.create({
        data: {
          id: newId(),
          companyId,
          fiscalYearId: fiscalYear.id,
          periodNumber: 1,
          startDate: new Date(Date.UTC(year, 0, 1)),
          endDate: new Date(Date.UTC(year, 11, 31)),
        },
      })
    ).id;

    const make = async (
      code: string,
      type: string,
      normalBalance: string,
      extra: { parentId?: string; isPostable?: boolean } = {},
    ): Promise<string> =>
      (
        await prisma.account.create({
          data: { id: newId(), companyId, code, name: code, type, normalBalance, ...extra },
        })
      ).id;

    group = await make("1", "ASSET", "DEBIT", { isPostable: false });
    leafA = await make("1001", "ASSET", "DEBIT", { parentId: group });
    leafB = await make("1002", "ASSET", "DEBIT", { parentId: group });
    equity = await make("3001", "EQUITY", "CREDIT");

    await post([
      { accountId: leafA, debit: "100.0000" },
      { accountId: equity, credit: "100.0000" },
    ]);
    secondEntryId = (
      await post([
        { accountId: leafB, debit: "50.2500" },
        { accountId: equity, credit: "50.2500" },
      ])
    ).journalEntryId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const byId = async (): Promise<Record<string, Awaited<ReturnType<AccountBalancesService["compute"]>>[number]>> =>
    Object.fromEntries((await balances.compute(companyId)).map((b) => [b.accountId, b]));

  it("gives each leaf its own totals and the parent the sum of its children", async () => {
    const result = await byId();

    expect(result[leafA]).toMatchObject({ debitTotal: "100.0000", creditTotal: "0.0000", balance: "100.0000", balanceSide: "DEBIT" });
    expect(result[leafB]).toMatchObject({ debitTotal: "50.2500", balanceSide: "DEBIT" });
    expect(result[group]).toMatchObject({ debitTotal: "150.2500", creditTotal: "0.0000", balance: "150.2500", balanceSide: "DEBIT" });
    expect(result[equity]).toMatchObject({ creditTotal: "150.2500", balanceSide: "CREDIT" });
  });

  it("counts a reversal like any other entry, so the balance follows the ledger", async () => {
    await engine.reverseEntry(secondEntryId, "test reversal", "test-actor", newId());
    const result = await byId();

    // leafB: original debit 50.25 + mirrored credit 50.25 -> nets to zero, both totals kept.
    expect(result[leafB]).toMatchObject({ debitTotal: "50.2500", creditTotal: "50.2500", balance: "0.0000", balanceSide: null });
    expect(result[group]).toMatchObject({ debitTotal: "150.2500", creditTotal: "50.2500", balance: "100.0000", balanceSide: "DEBIT" });
    expect(result[equity]).toMatchObject({ balance: "100.0000", balanceSide: "CREDIT" });
  });

  it("returns nothing for a company with no postings", async () => {
    expect(await balances.compute(newId())).toEqual([]);
  });
});
