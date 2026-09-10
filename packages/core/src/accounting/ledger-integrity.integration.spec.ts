import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { PrismaNumberingService } from "./numbering.service.js";
import { TrialBalanceService } from "./trial-balance.service.js";

// docs/05-ACCOUNTING-INTEGRITY-RULES.md §1: "Add a test that generates random valid
// business operations and asserts the trial balance is zero after each one. This
// test is the single best defence this system has." docs/10-TESTING-RULES.md §1:
// "Use a real PostgreSQL in integration tests, not SQLite or a mock." Requires
// DATABASE_URL (the erp_app runtime role) pointed at a real, migrated Postgres —
// skips gracefully otherwise rather than failing CI runs that don't have one wired
// up yet (tracked gap: not yet run via Testcontainers in CI — docs/12-OPS-AND-DEPLOYMENT.md
// §1 calls for that; this currently only runs against the local dev database).
const hasRealDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasRealDatabase ? describe : describe.skip;

describeIfDb("ledger integrity — property-based", () => {
  const prisma = new PrismaClient();
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);

  let companyId: string;
  let periodId: string;
  let accountIds: string[];
  const postedEntryIds: string[] = [];

  beforeAll(async () => {
    companyId = newId();
    const now = new Date();

    await prisma.company.create({
      data: { id: companyId, name: `Integrity Test ${companyId}`, defaultCurrency: "SAR" },
    });
    // docs/04-DATA-MODEL-RULES.md §3: calendar-fact dates must use UTC-explicit
    // construction, not the local-timezone Date constructor — `new Date(y, 0, 1)`
    // on a machine whose local timezone is ahead of UTC (e.g. Asia/Riyadh, UTC+3)
    // serializes to a `@db.Date` column as the PREVIOUS calendar day. This bit a
    // first draft of this exact test file.
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
    periodId = period.id;

    const accountSpecs = [
      { code: "1000", name: "Cash", type: "ASSET", normalBalance: "DEBIT" },
      { code: "1200", name: "Accounts Receivable", type: "ASSET", normalBalance: "DEBIT" },
      { code: "2000", name: "Accounts Payable", type: "LIABILITY", normalBalance: "CREDIT" },
      { code: "3000", name: "Owner's Equity", type: "EQUITY", normalBalance: "CREDIT" },
      { code: "4000", name: "Sales Revenue", type: "REVENUE", normalBalance: "CREDIT" },
      { code: "5000", name: "Operating Expense", type: "EXPENSE", normalBalance: "DEBIT" },
    ];
    const created = await Promise.all(
      accountSpecs.map((spec) =>
        prisma.account.create({
          data: { id: newId(), companyId, code: spec.code, name: spec.name, type: spec.type, normalBalance: spec.normalBalance },
        }),
      ),
    );
    accountIds = created.map((a) => a.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps the trial balance at exactly zero after every random valid operation, including reversals", async () => {
    const iterations = 40;

    for (let i = 0; i < iterations; i++) {
      const shouldReverse = postedEntryIds.length > 0 && Math.random() < 0.2;

      if (shouldReverse) {
        const target = postedEntryIds[Math.floor(Math.random() * postedEntryIds.length)];
        if (target) {
          await engine.reverseEntry(target, "random property test reversal", "test-actor", newId());
        }
      } else {
        const lineCount = 2 + Math.floor(Math.random() * 3); // 2-4 lines
        const selectedAccounts = shuffled(accountIds).slice(0, lineCount);
        const amounts = selectedAccounts.map(() => randomAmount());

        // Make it balance: last line absorbs the difference between the random
        // debit-side and credit-side totals generated so far.
        const half = Math.floor(lineCount / 2);
        const debitAccounts = selectedAccounts.slice(0, half);
        const creditAccounts = selectedAccounts.slice(half);
        const debitAmounts = amounts.slice(0, half);
        const total = debitAmounts.reduce((sum, a) => sum + a, 0);
        const creditAmounts = splitAmount(total, creditAccounts.length);

        // Safe non-null assertions: debitAmounts/creditAmounts are sliced to the
        // same length as debitAccounts/creditAccounts respectively (see above).
        const lines = [
          ...debitAccounts.map((accountId, idx) => ({
            accountId,
            debit: debitAmounts[idx]!.toFixed(2),
          })),
          ...creditAccounts.map((accountId, idx) => ({
            accountId,
            credit: creditAmounts[idx]!.toFixed(2),
          })),
        ];

        const result = await engine.postEntry({
          companyId,
          fiscalPeriodId: periodId,
          entryDate: new Date(),
          postingDate: new Date(),
          currency: "SAR",
          lines,
          sourceModule: "test",
          sourceDocumentType: "property_test",
          sourceDocumentId: newId(),
          actorId: "test-actor",
          correlationId: newId(),
          idempotencyKey: newId(),
        });
        postedEntryIds.push(result.journalEntryId);
      }

      const balance = await trialBalance.compute(companyId);
      expect(balance.isBalanced).toBe(true);
      expect(balance.totalDebit).toBe(balance.totalCredit);
    }
  }, 60_000);

  it("rejects posting into a closed fiscal period — enforced by the database", async () => {
    const closedPeriod = await prisma.fiscalPeriod.create({
      data: {
        id: newId(),
        companyId,
        fiscalYearId: (await prisma.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId } })).fiscalYearId,
        periodNumber: 2,
        startDate: new Date(Date.UTC(2020, 0, 1)),
        endDate: new Date(Date.UTC(2020, 11, 31)),
        status: "CLOSED",
      },
    });

    await expect(
      engine.postEntry({
        companyId,
        fiscalPeriodId: closedPeriod.id,
        entryDate: new Date(),
        postingDate: new Date(),
        currency: "SAR",
        lines: [
          { accountId: accountIds[0]!, debit: "10.00" },
          { accountId: accountIds[1]!, credit: "10.00" },
        ],
        sourceModule: "test",
        sourceDocumentType: "property_test",
        sourceDocumentId: newId(),
        actorId: "test-actor",
        correlationId: newId(),
        idempotencyKey: newId(),
      }),
    ).rejects.toThrow(/not open/);
  });

  it("replays an idempotent request instead of double-posting", async () => {
    const idempotencyKey = newId();
    const command = {
      companyId,
      fiscalPeriodId: periodId,
      entryDate: new Date(),
      postingDate: new Date(),
      currency: "SAR",
      lines: [
        { accountId: accountIds[0]!, debit: "5.00" },
        { accountId: accountIds[1]!, credit: "5.00" },
      ],
      sourceModule: "test",
      sourceDocumentType: "property_test",
      sourceDocumentId: newId(),
      actorId: "test-actor",
      correlationId: newId(),
      idempotencyKey,
    };

    const first = await engine.postEntry(command);
    const second = await engine.postEntry(command);
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.number).toBe(first.number);
  });
});

function randomAmount(): number {
  return Math.round((1 + Math.random() * 999) * 100) / 100;
}

function splitAmount(total: number, parts: number): number[] {
  if (parts === 1) {
    return [Math.round(total * 100) / 100];
  }
  const amounts: number[] = [];
  let remaining = Math.round(total * 100);
  for (let i = 0; i < parts - 1; i++) {
    const share = Math.floor(remaining / (parts - i) / 1) || 0;
    amounts.push(share / 100);
    remaining -= share;
  }
  amounts.push(remaining / 100);
  return amounts;
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
