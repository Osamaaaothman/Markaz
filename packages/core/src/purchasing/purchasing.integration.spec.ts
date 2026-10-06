import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { ApprovalPolicyService } from "../approvals/approval-policy.service.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { GoodsReceiptService } from "../inventory/goods-receipt.service.js";
import { ItemService } from "../inventory/item.service.js";
import { StockLevelService } from "../inventory/stock-level.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { PurchaseOrderError, PurchaseOrderService } from "./purchase-order.service.js";
import { PurchaseReceiptError, PurchaseReceiptService } from "./purchase-receipt.service.js";
import { PurchaseRequestError, PurchaseRequestService } from "./purchase-request.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Purchasing (M5, requests and orders) — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const numbering = new PrismaNumberingService();
  const engine = new PrismaAccountingEngine(prisma, numbering);
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const items = new ItemService(prisma, audit);
  const goodsReceipts = new GoodsReceiptService(prisma, engine, mappings, audit);
  const approvals = new ApprovalService();
  const policies = new ApprovalPolicyService(prisma, audit);
  const requests = new PurchaseRequestService(prisma, audit);
  const orders = new PurchaseOrderService(prisma, approvals, audit);
  const receiving = new PurchaseReceiptService(prisma, goodsReceipts, audit);
  const stockLevels = new StockLevelService(prisma);

  const companyId = newId();
  const actor = { id: "buyer", companyId };
  const cid = (): string => newId();

  const year = new Date().getUTCFullYear();
  const today = new Date();

  let inventoryAccountId: string;
  let grniAccountId: string;
  let warehouseId: string;
  let itemA: string;
  let itemB: string;
  let supplierId: string;

  async function balanceOf(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Purchasing Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        id: newId(),
        companyId,
        name: `FY${year}-${companyId.slice(0, 6)}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
    await prisma.fiscalPeriod.create({
      data: {
        id: newId(),
        companyId,
        fiscalYearId: fiscalYear.id,
        periodNumber: 1,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });

    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (
        await prisma.account.create({
          data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance },
        })
      ).id;
    inventoryAccountId = await make("1040", "Inventory", "ASSET", "DEBIT");
    grniAccountId = await make("2010", "GRNI", "LIABILITY", "CREDIT");
    await mappings.set("INVENTORY", inventoryAccountId, actor, cid());
    await mappings.set("GRNI", grniAccountId, actor, cid());

    warehouseId = (await warehouses.create({ code: "WH1", name: "Main" }, actor, cid())).id;
    itemA = (await items.create({ code: "CEM", name: "Cement", unit: "BAG" }, actor, cid())).id;
    itemB = (await items.create({ code: "SND", name: "Sand", unit: "M3" }, actor, cid())).id;
    supplierId = (
      await prisma.party.create({ data: { id: newId(), ref: `TEST-PRT-${companyId.slice(0, 6)}`, companyId, name: "Supplier Co", kind: "COMPANY" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("numbers requests gaplessly and turns a request into an order", async () => {
    const request = await requests.create({ lines: [{ itemId: itemA, quantity: "100" }] }, actor, cid());
    expect(request.number).toMatch(/^PRQ-.*-000001$/);
    expect(request.status).toBe("PENDING");

    const second = await requests.create({ lines: [{ itemId: itemB, quantity: "5" }] }, actor, cid());
    expect(second.number).toMatch(/-000002$/);

    const order = await orders.create(
      { supplierId, orderDate: today, purchaseRequestId: request.id, lines: [{ itemId: itemA, quantity: "100", unitPrice: "12.5" }] },
      actor,
      cid(),
    );
    expect(order.number).toMatch(/^PO-.*-000001$/);
    expect(order.status).toBe("APPROVED"); // no policy yet

    expect((await requests.get(companyId, request.id)).status).toBe("PROCESSED");
    await expect(
      orders.create({ supplierId, orderDate: today, purchaseRequestId: request.id, lines: [{ itemId: itemA, quantity: "1", unitPrice: "1" }] }, actor, cid()),
    ).rejects.toMatchObject({ code: "REQUEST_NOT_PENDING" });

    await requests.reject(second.id, "Not needed", actor, cid());
    await expect(requests.reject(second.id, "again", actor, cid())).rejects.toBeInstanceOf(PurchaseRequestError);
  });

  it("receives in parts at the order price, never beyond the quantity ordered, and ties out to the ledger", async () => {
    const order = await orders.create(
      { supplierId, orderDate: today, lines: [{ itemId: itemB, quantity: "10", unitPrice: "40" }, { itemId: itemA, quantity: "4", unitPrice: "25" }] },
      actor,
      cid(),
    );
    const detail = await orders.get(companyId, order.id);
    const sand = detail.lines.find((l) => l.itemId === itemB)!;
    const cement = detail.lines.find((l) => l.itemId === itemA)!;

    const inventoryBefore = await balanceOf(inventoryAccountId);
    const grniBefore = await balanceOf(grniAccountId);

    const first = await receiving.receive(
      order.id,
      { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: sand.id, quantity: "6" }] },
      actor,
      cid(),
      newId(),
    );
    expect(first.orderStatus).toBe("PARTIALLY_RECEIVED");
    expect(await balanceOf(inventoryAccountId)).toBeCloseTo(inventoryBefore + 240, 4);
    expect(await balanceOf(grniAccountId)).toBeCloseTo(grniBefore - 240, 4);

    await expect(
      receiving.receive(order.id, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: sand.id, quantity: "5" }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "OVER_RECEIPT" });
    // The rejected attempt left nothing behind.
    expect((await orders.get(companyId, order.id)).lines.find((l) => l.itemId === itemB)?.receivedQuantity).toBe("6.0000");

    const last = await receiving.receive(
      order.id,
      {
        warehouseId,
        documentDate: today,
        lines: [
          { purchaseOrderLineId: sand.id, quantity: "4" },
          { purchaseOrderLineId: cement.id, quantity: "4" },
        ],
      },
      actor,
      cid(),
      newId(),
    );
    expect(last.orderStatus).toBe("RECEIVED");

    // Stock sub-ledger equals the Inventory control account (docs/05 §7).
    const stockValue = (await stockLevels.list(companyId, {})).reduce((sum, r) => sum + Number(r.value), 0);
    expect(await balanceOf(inventoryAccountId)).toBeCloseTo(stockValue, 4);

    await expect(
      receiving.receive(order.id, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: cement.id, quantity: "1" }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "ORDER_NOT_RECEIVABLE" });
    await expect(orders.cancel(order.id, actor, cid())).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
  });

  it("holds an order above the approval threshold until it is approved, and blocks receiving meanwhile", async () => {
    await policies.set("purchase_order", "1000", actor, cid());

    const small = await orders.create({ supplierId, orderDate: today, lines: [{ itemId: itemA, quantity: "1", unitPrice: "1000" }] }, actor, cid());
    expect(small.status).toBe("APPROVED"); // exactly at the threshold is not above it

    const big = await orders.create({ supplierId, orderDate: today, lines: [{ itemId: itemA, quantity: "1", unitPrice: "1000.0001" }] }, actor, cid());
    expect(big.status).toBe("PENDING_APPROVAL");

    const line = (await orders.get(companyId, big.id)).lines[0]!;
    await expect(
      receiving.receive(big.id, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: line.id, quantity: "1" }] }, actor, cid(), newId()),
    ).rejects.toBeInstanceOf(PurchaseReceiptError);

    expect((await orders.decide(big.id, "APPROVED", actor, cid())).status).toBe("APPROVED");
    await expect(orders.decide(big.id, "REJECTED", actor, cid())).rejects.toMatchObject({ code: "NOT_PENDING_APPROVAL" });

    const received = await receiving.receive(
      big.id,
      { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: line.id, quantity: "1" }] },
      actor,
      cid(),
      newId(),
    );
    expect(received.orderStatus).toBe("RECEIVED");

    await policies.set("purchase_order", null, actor, cid());
  });

  it("cancels an order nothing was received against, and rejects one that is pending approval", async () => {
    await policies.set("purchase_order", "10", actor, cid());
    const pending = await orders.create({ supplierId, orderDate: today, lines: [{ itemId: itemA, quantity: "1", unitPrice: "50" }] }, actor, cid());
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect((await orders.cancel(pending.id, actor, cid())).status).toBe("CANCELLED");
    await expect(orders.decide(pending.id, "APPROVED", actor, cid())).rejects.toBeInstanceOf(PurchaseOrderError);
    await policies.set("purchase_order", null, actor, cid());
  });

  it("does not let one company see or receive against another company's order", async () => {
    const order = await orders.create({ supplierId, orderDate: today, lines: [{ itemId: itemA, quantity: "1", unitPrice: "5" }] }, actor, cid());
    const stranger = { id: "stranger", companyId: newId() };
    await expect(orders.get(stranger.companyId, order.id)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(
      receiving.receive(order.id, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: newId(), quantity: "1" }] }, stranger, cid(), newId()),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});
