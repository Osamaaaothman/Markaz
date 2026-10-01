import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "./account-mapping.service.js";
import { WarehouseService } from "./warehouse.service.js";
import { ItemService } from "./item.service.js";
import { GoodsReceiptService } from "./goods-receipt.service.js";
import { StockIssueService, StockIssueError } from "./stock-issue.service.js";
import { StockCountService } from "./stock-count.service.js";
import { StockLevelService } from "./stock-level.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Inventory (M4) — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const numbering = new PrismaNumberingService();
  const engine = new PrismaAccountingEngine(prisma, numbering);
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const items = new ItemService(prisma, audit);
  const goodsReceipts = new GoodsReceiptService(prisma, engine, mappings, audit);
  const stockIssues = new StockIssueService(prisma, engine, mappings, audit);
  const stockCounts = new StockCountService(prisma, engine, numbering, mappings, audit);
  const stockLevels = new StockLevelService(prisma);

  const companyId = newId();
  const actor = { id: "test-actor", companyId };
  const cid = (): string => newId();
  const idk = (): string => newId();

  let periodId: string;
  let inventoryAccountId: string;
  let grniAccountId: string;
  let expenseAccountId: string;
  let lossAccountId: string;
  let gainAccountId: string;
  let warehouseId: string;
  let itemId: string;

  async function inventoryAccountBalance(): Promise<number> {
    const result = await trialBalance.compute(companyId);
    const row = result.lines.find((a) => a.accountId === inventoryAccountId);
    if (!row) return 0;
    return Number(row.debitTotal) - Number(row.creditTotal);
  }

  async function totalStockValue(): Promise<number> {
    const rows = await stockLevels.list(companyId, {});
    return rows.reduce((sum, r) => sum + Number(r.value), 0);
  }

  beforeAll(async () => {
    const now = new Date();
    await prisma.company.create({ data: { id: companyId, name: `Inventory Test ${companyId}`, defaultCurrency: "SAR" } });
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
      { code: "1040", name: "Inventory", type: "ASSET", normalBalance: "DEBIT" },
      { code: "2010", name: "GRN - Payables", type: "LIABILITY", normalBalance: "CREDIT" },
      { code: "5010", name: "Direct Costs", type: "EXPENSE", normalBalance: "DEBIT" },
      { code: "5090", name: "Stock Count Loss", type: "EXPENSE", normalBalance: "DEBIT" },
      { code: "4090", name: "Stock Count Gain", type: "REVENUE", normalBalance: "CREDIT" },
    ];
    const created: Record<string, string> = {};
    for (const spec of accountSpecs) {
      const account = await prisma.account.create({
        data: { id: newId(), ref: `TEST-${spec.code}`, companyId, code: spec.code, name: spec.name, type: spec.type, normalBalance: spec.normalBalance },
      });
      created[spec.code] = account.id;
    }
    inventoryAccountId = created["1040"]!;
    grniAccountId = created["2010"]!;
    expenseAccountId = created["5010"]!;
    lossAccountId = created["5090"]!;
    gainAccountId = created["4090"]!;

    await mappings.set("INVENTORY", inventoryAccountId, actor, cid());
    await mappings.set("GRNI", grniAccountId, actor, cid());
    await mappings.set("PROJECT_ISSUE_EXPENSE", expenseAccountId, actor, cid());
    await mappings.set("COUNT_LOSS", lossAccountId, actor, cid());
    await mappings.set("COUNT_GAIN", gainAccountId, actor, cid());

    warehouseId = (await warehouses.create({ code: "WH1", name: "Main Warehouse" }, actor, cid())).id;
    itemId = (await items.create({ code: "ITM1", name: "Widget", unit: "EA" }, actor, cid())).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("receiving stock debits Inventory and credits GRNI for exactly quantity * unit cost", async () => {
    const before = await inventoryAccountBalance();

    const receipt = await goodsReceipts.create(
      { warehouseId, documentDate: new Date(), lines: [{ itemId, quantity: "10", unitCost: "100" }] },
      actor,
      cid(),
      idk(),
    );
    expect(receipt.number).toBeTruthy();

    const after = await inventoryAccountBalance();
    expect(after - before).toBeCloseTo(1000, 4);

    const levels = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(levels[0]?.quantity).toBe("10.0000");
    expect(levels[0]?.value).toBe("1000.0000");
  });

  it("a second receipt at a different cost blends into one weighted average", async () => {
    await goodsReceipts.create(
      { warehouseId, documentDate: new Date(), lines: [{ itemId, quantity: "10", unitCost: "120" }] },
      actor,
      cid(),
      idk(),
    );
    const levels = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(levels[0]?.quantity).toBe("20.0000");
    expect(levels[0]?.value).toBe("2200.0000");
    expect(levels[0]?.averageUnitCost).toBe("110.0000");
  });

  it("issuing stock debits the project expense account at the weighted-average cost", async () => {
    const before = await inventoryAccountBalance();

    const issue = await stockIssues.create(
      { warehouseId, costCenterRef: "PROJECT-1", documentDate: new Date(), lines: [{ itemId, quantity: "5" }] },
      actor,
      cid(),
      idk(),
    );
    expect(issue.number).toBeTruthy();

    const after = await inventoryAccountBalance();
    expect(before - after).toBeCloseTo(550, 4); // 5 * 110

    const levels = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(levels[0]?.quantity).toBe("15.0000");
    expect(levels[0]?.value).toBe("1650.0000");
  });

  it("refuses to issue more than is on hand, and leaves stock and the ledger untouched", async () => {
    const levelsBefore = await stockLevels.list(companyId, { itemId, warehouseId });
    const balanceBefore = await inventoryAccountBalance();

    await expect(
      stockIssues.create(
        { warehouseId, costCenterRef: "PROJECT-1", documentDate: new Date(), lines: [{ itemId, quantity: "1000" }] },
        actor,
        cid(),
        idk(),
      ),
    ).rejects.toThrow(StockIssueError);

    const levelsAfter = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(levelsAfter[0]?.quantity).toBe(levelsBefore[0]?.quantity);
    expect(levelsAfter[0]?.value).toBe(levelsBefore[0]?.value);
    expect(await inventoryAccountBalance()).toBeCloseTo(balanceBefore, 4);
  });

  it("a concurrent issue for the last unit lets exactly one succeed", async () => {
    const soloItemId = (await items.create({ code: "ITM-SOLO", name: "Solo Widget", unit: "EA" }, actor, cid())).id;
    await goodsReceipts.create(
      { warehouseId, documentDate: new Date(), lines: [{ itemId: soloItemId, quantity: "1", unitCost: "50" }] },
      actor,
      cid(),
      idk(),
    );

    const attempt = () =>
      stockIssues.create(
        { warehouseId, costCenterRef: "RACE", documentDate: new Date(), lines: [{ itemId: soloItemId, quantity: "1" }] },
        actor,
        cid(),
        idk(),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const levels = await stockLevels.list(companyId, { itemId: soloItemId, warehouseId });
    expect(levels[0]?.quantity).toBe("0.0000");
    expect(levels[0]?.value).toBe("0.0000");
  });

  it("a stock count shortage debits the loss account at the cost captured when the count was recorded", async () => {
    const before = await inventoryAccountBalance();

    const recorded = await stockCounts.record(
      { warehouseId, documentDate: new Date(), lines: [{ itemId, countedQuantity: "12" }] }, // was 15, short 3
      actor,
      cid(),
    );
    expect(recorded.number).toBeTruthy();

    const posted = await stockCounts.post(recorded.id, actor, cid(), idk());
    expect(posted.journalEntryId).not.toBeNull();

    const after = await inventoryAccountBalance();
    expect(before - after).toBeCloseTo(330, 4); // 3 short * 110 average captured at record time

    const levels = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(levels[0]?.quantity).toBe("12.0000");
    expect(levels[0]?.value).toBe("1320.0000");
  });

  it("a stock count with no variance posts nothing, and posting twice is refused", async () => {
    const recorded = await stockCounts.record(
      { warehouseId, documentDate: new Date(), lines: [{ itemId, countedQuantity: "12" }] }, // matches the books exactly
      actor,
      cid(),
    );
    const posted = await stockCounts.post(recorded.id, actor, cid(), idk());
    expect(posted.journalEntryId).toBeNull();

    await expect(stockCounts.post(recorded.id, actor, cid(), idk())).rejects.toThrow("already posted");
  });

  it("the Inventory control account always equals the sum of what the stock-levels screen shows", async () => {
    // docs/05-ACCOUNTING-INTEGRITY-RULES.md §7: sub-ledger to general-ledger reconciliation.
    // All the operations above touched the same item/warehouse; this is the gate, checked
    // once at the end against everything that happened in this whole test file.
    const ledgerBalance = await inventoryAccountBalance();
    const subLedgerTotal = await totalStockValue();
    expect(ledgerBalance).toBeCloseTo(subLedgerTotal, 4);
  });

  it("rolling back a caller transaction after postEntry leaves the stock row untouched too", async () => {
    const before = await stockLevels.list(companyId, { itemId, warehouseId });

    class RollbackForTest extends Error {}
    await expect(
      prisma.$transaction(async (tx) => {
        // Exercises the same tx-aware postEntry path goods receipt/issue use, directly.
        await engine.postEntry(
          {
            companyId,
            fiscalPeriodId: periodId,
            entryDate: new Date(),
            postingDate: new Date(),
            currency: "SAR",
            lines: [
              { accountId: inventoryAccountId, debit: "999.0000" },
              { accountId: grniAccountId, credit: "999.0000" },
            ],
            sourceModule: "inventory",
            sourceDocumentType: "inventory_rollback_test",
            sourceDocumentId: newId(),
            actorId: actor.id,
            correlationId: cid(),
            idempotencyKey: idk(),
          },
          tx,
        );
        throw new RollbackForTest();
      }),
    ).rejects.toThrow(RollbackForTest);

    const after = await stockLevels.list(companyId, { itemId, warehouseId });
    expect(after[0]?.quantity).toBe(before[0]?.quantity);
    expect(after[0]?.value).toBe(before[0]?.value);
  });
});
