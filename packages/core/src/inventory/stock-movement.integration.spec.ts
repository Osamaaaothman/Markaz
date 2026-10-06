import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "./account-mapping.service.js";
import { GoodsReceiptService } from "./goods-receipt.service.js";
import { ItemService } from "./item.service.js";
import { StockIssueService } from "./stock-issue.service.js";
import { StockMovementService } from "./stock-movement.service.js";
import { WarehouseService } from "./warehouse.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Stock movements (stock card) — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const mappings = new AccountMappingService(prisma, audit);
  const movements = new StockMovementService(prisma);

  const companyId = newId();
  const actor = { id: "keeper", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();
  let warehouseId: string;
  let itemId: string;

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Movements Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name: code, type, normalBalance } })).id;
    await mappings.set("INVENTORY", await make("1040", "ASSET", "DEBIT"), actor, cid());
    await mappings.set("GRNI", await make("2010", "LIABILITY", "CREDIT"), actor, cid());
    await mappings.set("PROJECT_ISSUE_EXPENSE", await make("5010", "EXPENSE", "DEBIT"), actor, cid());
    warehouseId = (await new WarehouseService(prisma, audit).create({ code: "W1", name: "Main" }, actor, cid())).id;
    itemId = (await new ItemService(prisma, audit).create({ code: "I1", name: "Item", unit: "EA" }, actor, cid())).id;
    await new GoodsReceiptService(prisma, engine, mappings, audit).create({ warehouseId, documentDate: today, lines: [{ itemId, quantity: "10", unitCost: "5" }] }, actor, cid(), newId());
    await new StockIssueService(prisma, engine, mappings, audit).create({ warehouseId, costCenterRef: "Project A", documentDate: today, lines: [{ itemId, quantity: "4" }] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists movements newest first with signed quantities and the posting entry number", async () => {
    const page = await movements.list(companyId, {});
    expect(page.data.map((m) => [m.movementType, m.quantity, m.value])).toEqual([
      ["ISSUE", "-4.0000", "20.0000"],
      ["RECEIPT", "10.0000", "50.0000"],
    ]);
    expect(page.data[0]?.entryNumber).toBeTruthy();
    expect(page.pageInfo.hasMore).toBe(false);
  });

  it("filters by type, item, and date, and pages with a cursor", async () => {
    expect((await movements.list(companyId, { movementType: "RECEIPT" })).data).toHaveLength(1);
    expect((await movements.list(companyId, { itemId: newId() })).data).toHaveLength(0);
    const day = new Date(Date.UTC(year, today.getUTCMonth(), today.getUTCDate()));
    expect((await movements.list(companyId, { from: day, to: day })).data).toHaveLength(2);
    expect((await movements.list(companyId, { to: new Date(Date.UTC(year - 1, 0, 1)) })).data).toHaveLength(0);

    const first = await movements.list(companyId, { limit: "1" });
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await movements.list(companyId, { limit: "1", cursor: first.pageInfo.nextCursor! });
    expect(second.data[0]?.movementType).toBe("RECEIPT");
  });

  it("exports oldest first, and never shows another company's movements", async () => {
    expect((await movements.listForExport(companyId, {})).map((m) => m.movementType)).toEqual(["RECEIPT", "ISSUE"]);
    expect((await movements.list(newId(), {})).data).toEqual([]);
  });
});
