import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { GoodsReceiptService } from "../inventory/goods-receipt.service.js";
import { ItemService } from "../inventory/item.service.js";
import { StockLevelService } from "../inventory/stock-level.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { SalesOrderService } from "./sales-order.service.js";
import { GoodsDeliveryNoteService } from "./goods-delivery-note.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Goods delivery note (sales) — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const items = new ItemService(prisma, audit);
  const receipts = new GoodsReceiptService(prisma, engine, mappings, audit);
  const stockLevels = new StockLevelService(prisma);
  const taxCodes = new TaxCodeService(prisma, audit);
  const orders = new SalesOrderService(prisma, audit);
  const deliveryNotes = new GoodsDeliveryNoteService(prisma, audit);

  const companyId = newId();
  const actor = { id: "storekeeper", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let warehouseId: string;
  let itemId: string;
  let customerId: string;
  let vat15: string;
  let orderId: string;
  let itemLineId: string;
  let serviceLineId: string;

  async function stockQuantity(): Promise<string> {
    const rows = await stockLevels.list(companyId, { itemId });
    return rows[0]?.quantity ?? "0.0000";
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Delivery Note Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance } })).id;
    const inventory = await make("1040", "Inventory", "ASSET", "DEBIT");
    const grni = await make("2010", "GRNI", "LIABILITY", "CREDIT");
    await mappings.set("INVENTORY", inventory, actor, cid());
    await mappings.set("GRNI", grni, actor, cid());

    const codes = await taxCodes.addSaudiDefaults(actor, cid());
    vat15 = codes.find((c) => c.code === "VAT15")!.id;

    warehouseId = (await warehouses.create({ code: "WH1", name: "Main" }, actor, cid())).id;
    itemId = (await items.create({ code: "CEM", name: "Cement", unit: "BAG" }, actor, cid())).id;
    customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C1-${companyId.slice(0, 6)}`, companyId, name: "Customer Co", nameAr: "شركة العميل", kind: "COMPANY" } })).id;

    await receipts.create({ warehouseId, documentDate: today, lines: [{ itemId, quantity: "10", unitCost: "50" }] }, actor, cid(), newId());

    const order = await orders.create(
      {
        customerId,
        orderDate: today,
        lines: [
          { itemId, quantity: "10", unitPrice: "100", taxCodeId: vat15 },
          { description: "Installation", quantity: "1", unitPrice: "200", taxCodeId: vat15 },
        ],
      },
      actor,
      cid(),
    );
    orderId = order.id;
    const detail = await orders.get(companyId, orderId);
    itemLineId = detail.lines.find((l) => l.itemId === itemId)!.id;
    serviceLineId = detail.lines.find((l) => l.itemId === null)!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records a partial delivery with no stock or ledger effect", async () => {
    const stockBefore = await stockQuantity();

    const note = await deliveryNotes.create(
      { salesOrderId: orderId, deliveryDate: today, driverName: "Ali", receiverName: "Khalid", lines: [{ salesOrderLineId: itemLineId, quantity: "4" }] },
      actor,
      cid(),
    );
    expect(note.number).toMatch(/^DN-.*-000001$/);

    const detail = await deliveryNotes.getById(note.id, companyId);
    expect(detail.driverName).toBe("Ali");
    expect(detail.receiverName).toBe("Khalid");
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]!.quantity).toBe("4.0000");
    expect(detail.lines[0]!.itemCode).toBe("CEM");

    // Stock and the ledger are untouched — the order line's deliveredQuantity is the only change.
    expect(await stockQuantity()).toBe(stockBefore);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);

    const order = await orders.get(companyId, orderId);
    expect(order.lines.find((l) => l.id === itemLineId)).toMatchObject({ quantity: "10.0000" });
  });

  it("allows a second partial delivery covering the remaining quantity", async () => {
    const note = await deliveryNotes.create(
      { salesOrderId: orderId, deliveryDate: today, lines: [{ salesOrderLineId: itemLineId, quantity: "6" }] },
      actor,
      cid(),
    );
    expect(note.number).toMatch(/^DN-.*-000002$/);

    const list = await deliveryNotes.list(companyId, { salesOrderId: orderId });
    expect(list.data).toHaveLength(2);
  });

  it("refuses to deliver more than what remains outstanding on the order line", async () => {
    await expect(
      deliveryNotes.create({ salesOrderId: orderId, deliveryDate: today, lines: [{ salesOrderLineId: itemLineId, quantity: "1" }] }, actor, cid()),
    ).rejects.toMatchObject({ code: "OVER_DELIVERY" });
  });

  it("refuses a line that does not belong to the order, and an empty delivery", async () => {
    const otherOrder = await orders.create({ customerId, orderDate: today, lines: [{ itemId, quantity: "1", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid());
    const otherDetail = await orders.get(companyId, otherOrder.id);
    const otherLineId = otherDetail.lines[0]!.id;

    await expect(
      deliveryNotes.create({ salesOrderId: orderId, deliveryDate: today, lines: [{ salesOrderLineId: otherLineId, quantity: "1" }] }, actor, cid()),
    ).rejects.toMatchObject({ code: "LINE_NOT_ON_ORDER" });

    await expect(deliveryNotes.create({ salesOrderId: orderId, deliveryDate: today, lines: [] }, actor, cid())).rejects.toMatchObject({ code: "EMPTY_DELIVERY" });
  });

  it("delivers a service line with a zero item id and a custom description", async () => {
    const note = await deliveryNotes.create(
      { salesOrderId: orderId, deliveryDate: today, lines: [{ salesOrderLineId: serviceLineId, quantity: "1", description: "Installation completed on site" }] },
      actor,
      cid(),
    );
    const detail = await deliveryNotes.getById(note.id, companyId);
    expect(detail.lines[0]).toMatchObject({ itemId: null, description: "Installation completed on site" });
  });

  it("is idempotent under the same submission key — a retried request never double-delivers", async () => {
    const order = await orders.create({ customerId, orderDate: today, lines: [{ itemId, quantity: "2", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid());
    const detail = await orders.get(companyId, order.id);
    const lineId = detail.lines[0]!.id;

    const replayKey = newId();
    const a = await deliveryNotes.create({ salesOrderId: order.id, deliveryDate: today, lines: [{ salesOrderLineId: lineId, quantity: "1" }] }, actor, cid(), replayKey);
    const b = await deliveryNotes.create({ salesOrderId: order.id, deliveryDate: today, lines: [{ salesOrderLineId: lineId, quantity: "1" }] }, actor, cid(), replayKey);
    expect(b.id).toBe(a.id);

    // Only one delivery actually happened: 1 more unit (not 2) is still deliverable.
    await expect(
      deliveryNotes.create({ salesOrderId: order.id, deliveryDate: today, lines: [{ salesOrderLineId: lineId, quantity: "1.5" }] }, actor, cid()),
    ).rejects.toMatchObject({ code: "OVER_DELIVERY" });
    await deliveryNotes.create({ salesOrderId: order.id, deliveryDate: today, lines: [{ salesOrderLineId: lineId, quantity: "1" }] }, actor, cid());
  });
});
