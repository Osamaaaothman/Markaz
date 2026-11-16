// Real database (docs/10-TESTING-RULES.md §1), skipped gracefully without one —
// same convention as packages/core/src/accounting/ledger-integrity.integration.spec.ts.
//
// Proves the actual bug report: two journal entries from DIFFERENT source document
// types land on the same `number` (each is gapless only within its own
// (company, documentType, fiscalYear) series — docs/01-OPEN-DECISIONS.md §L), but
// must still get distinct, creation-ordered `ledgerNumber` values from
// ledgerNumbersByEntryId, and a second company's entries must never affect the count.
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAccountingEngine } from "@erp/core";
import { PrismaNumberingService } from "@erp/core";
import { ledgerNumbersByEntryId } from "./ledger-number.js";

const hasRealDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasRealDatabase ? describe : describe.skip;

describeIfDb("ledgerNumbersByEntryId", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedCompany() {
    const companyId = newId();
    const now = new Date();
    await prisma.company.create({ data: { id: companyId, name: `Ledger Number Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        id: newId(),
        companyId,
        name: `FY${now.getFullYear()}-${companyId.slice(0, 6)}`,
        startDate: new Date(Date.UTC(now.getFullYear(), 0, 1)),
        endDate: new Date(Date.UTC(now.getFullYear(), 11, 31)),
      },
    });
    const period = await prisma.fiscalPeriod.create({
      data: {
        id: newId(),
        companyId,
        fiscalYearId: fiscalYear.id,
        periodNumber: 1,
        startDate: new Date(Date.UTC(now.getFullYear(), 0, 1)),
        endDate: new Date(Date.UTC(now.getFullYear(), 11, 31)),
      },
    });
    const [cash, revenue] = await Promise.all([
      prisma.account.create({ data: { id: newId(), ref: `TEST-CASH-${companyId}`, companyId, code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT", isPostable: true, isActive: true } }),
      prisma.account.create({ data: { id: newId(), ref: `TEST-REV-${companyId}`, companyId, code: "4000", name: "Revenue", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, isActive: true } }),
    ]);
    return { companyId, periodId: period.id, cashAccountId: cash.id, revenueAccountId: revenue.id };
  }

  async function post(
    companyId: string,
    periodId: string,
    cashAccountId: string,
    revenueAccountId: string,
    sourceDocumentType: string,
  ) {
    const entryDate = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 2));
    const result = await engine.postEntry({
      companyId,
      fiscalPeriodId: periodId,
      entryDate,
      postingDate: entryDate,
      currency: "SAR",
      lines: [
        { accountId: cashAccountId, debit: "10.00" },
        { accountId: revenueAccountId, credit: "10.00" },
      ],
      sourceModule: "test",
      sourceDocumentType,
      sourceDocumentId: newId(),
      actorId: newId(),
      correlationId: newId(),
      idempotencyKey: newId(),
    });
    return result.journalEntryId;
  }

  it("gives distinct, creation-ordered numbers even when two source types collide on `number`", async () => {
    const { companyId, periodId, cashAccountId, revenueAccountId } = await seedCompany();

    // cash_expense and sales_invoice each get their own 1,2,... series, so this
    // reproduces the exact report: by the end both types are at "2", and if the
    // register showed `number` it would show two entries as "000002".
    const ids: [string, string, string, string] = [
      await post(companyId, periodId, cashAccountId, revenueAccountId, "cash_expense"),
      await post(companyId, periodId, cashAccountId, revenueAccountId, "sales_invoice"),
      await post(companyId, periodId, cashAccountId, revenueAccountId, "cash_expense"),
      await post(companyId, periodId, cashAccountId, revenueAccountId, "sales_invoice"),
    ];

    const [cashExpense1, salesInvoice1, cashExpense2, salesInvoice2] = ids;
    const entries = await prisma.journalEntry.findMany({ where: { id: { in: ids } } });
    const numbersByType = new Map(entries.map((e) => [e.id, e.number]));
    expect(numbersByType.get(cashExpense1)).toBe("000001"); // cash_expense #1
    expect(numbersByType.get(salesInvoice1)).toBe("000001"); // sales_invoice #1 — collides with the line above
    expect(numbersByType.get(cashExpense2)).toBe("000002"); // cash_expense #2
    expect(numbersByType.get(salesInvoice2)).toBe("000002"); // sales_invoice #2 — collides with the line above

    const ledgerNumbers = await ledgerNumbersByEntryId(prisma, companyId, ids);
    expect(ids.map((id) => ledgerNumbers.get(id))).toEqual(["000001", "000002", "000003", "000004"]);
    // Every value distinct — the whole point of the fix.
    expect(new Set(ledgerNumbers.values()).size).toBe(4);
  });

  it("never counts another company's entries", async () => {
    const companyA = await seedCompany();
    const companyB = await seedCompany();

    const idsA = [
      await post(companyA.companyId, companyA.periodId, companyA.cashAccountId, companyA.revenueAccountId, "cash_expense"),
      await post(companyA.companyId, companyA.periodId, companyA.cashAccountId, companyA.revenueAccountId, "cash_expense"),
    ];
    // Several entries in company B, posted in between A's two — must not shift A's numbers.
    await post(companyB.companyId, companyB.periodId, companyB.cashAccountId, companyB.revenueAccountId, "cash_expense");
    await post(companyB.companyId, companyB.periodId, companyB.cashAccountId, companyB.revenueAccountId, "cash_expense");
    await post(companyB.companyId, companyB.periodId, companyB.cashAccountId, companyB.revenueAccountId, "cash_expense");

    const ledgerNumbers = await ledgerNumbersByEntryId(prisma, companyA.companyId, idsA);
    expect(idsA.map((id) => ledgerNumbers.get(id))).toEqual(["000001", "000002"]);
  });

  it("returns an empty map for an empty id list without querying", async () => {
    const result = await ledgerNumbersByEntryId(prisma, newId(), []);
    expect(result.size).toBe(0);
  });
});
