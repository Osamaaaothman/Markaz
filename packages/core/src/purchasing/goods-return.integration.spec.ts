import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { AccountMappingService, UnmappedAccountError } from "../inventory/account-mapping.service.js";
import { GoodsReceiptService } from "../inventory/goods-receipt.service.js";
import { ItemService } from "../inventory/item.service.js";
import { StockLevelService } from "../inventory/stock-level.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { GoodsReturnError, GoodsReturnService } from "./goods-return.service.js";
import { PurchaseOrderService } from "./purchase-order.service.js";
import { PurchaseReceiptService } from "./purchase-receipt.service.js";
import { SupplierInvoiceService } from "./supplier-invoice.service.js";
import { TaxCodeService } from "./tax-code.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Purchase returns (M5) — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const numbering = new PrismaNumberingService();
  const engine = new PrismaAccountingEngine(prisma, numbering);
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const warehouses = new WarehouseService(prisma, audit);
  const items = new ItemService(prisma, audit);
  const orders = new PurchaseOrderService(prisma, new ApprovalService(), audit);
  const receiving = new PurchaseReceiptService(prisma, new GoodsReceiptService(prisma, engine, mappings, audit), audit);
  const returns = new GoodsReturnService(prisma, engine, mappings, audit);
  const invoices = new SupplierInvoiceService(prisma, engine, mappings, audit);
  const taxCodes = new TaxCodeService(prisma, audit);
  const stockLevels = new StockLevelService(prisma);

  const companyId = newId();
  const actor = { id: "buyer", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let acc: Record<string, string>;
  let warehouseId: string;
  let emptyWarehouseId: string;
  let supplierId: string;
  let vat15: string;
  let itemCounter = 0;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  // A fresh item, an order for it, and part or all of the order received into the main warehouse.
  async function receivedOrder(quantity: string, unitPrice: string, receive: string, itemId?: string) {
    const item = itemId ?? (await items.create({ code: `RET${++itemCounter}`, name: `Returnable ${itemCounter}`, unit: "EA" }, actor, cid())).id;
    const order = await orders.create({ supplierId, warehouseId, orderDate: today, lines: [{ itemId: item, quantity, unitPrice, taxCodeId: vat15 }] }, actor, cid());
    const lineId = (await orders.get(companyId, order.id)).lines[0]!.id;
    await receiving.receive(order.id, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: lineId, quantity: receive }] }, actor, cid(), newId());
    return { itemId: item, orderId: order.id, lineId };
  }

  const returnInput = (orderId: string, lineId: string, quantity: string, wh = warehouseId) => ({
    purchaseOrderId: orderId,
    warehouseId: wh,
    documentDate: today,
    lines: [{ purchaseOrderLineId: lineId, quantity }],
  });

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Return Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance } })).id;
    acc = {
      inventory: await make("1040", "Inventory", "ASSET", "DEBIT"),
      grni: await make("2010", "GRNI", "LIABILITY", "CREDIT"),
      ap: await make("2100", "Accounts payable", "LIABILITY", "CREDIT"),
      vat: await make("1300", "Input VAT", "ASSET", "DEBIT"),
      ppv: await make("5900", "Price variance", "EXPENSE", "DEBIT"),
    };
    await mappings.set("INVENTORY", acc.inventory!, actor, cid());
    await mappings.set("GRNI", acc.grni!, actor, cid());
    await mappings.set("ACCOUNTS_PAYABLE", acc.ap!, actor, cid());
    await mappings.set("VAT_INPUT", acc.vat!, actor, cid());
    // PURCHASE_PRICE_VARIANCE is deliberately left unmapped until the cost-difference test.

    vat15 = (await taxCodes.addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT15")!.id;
    warehouseId = (await warehouses.create({ code: "WH1", name: "Main" }, actor, cid())).id;
    emptyWarehouseId = (await warehouses.create({ code: "WH2", name: "Empty" }, actor, cid())).id;
    supplierId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-S1-${companyId.slice(0, 6)}`, companyId, name: "Supplier Co", kind: "COMPANY" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reverses the receipt exactly when the cost has not moved: no variance line, status follows the counters", async () => {
    const { itemId, orderId, lineId } = await receivedOrder("5", "50", "5");
    const inventory = await balance(acc.inventory!);
    const grni = await balance(acc.grni!);

    const result = await returns.create(returnInput(orderId, lineId, "2"), actor, cid(), newId());
    expect(result.number).toBeTruthy();
    expect(result.orderStatus).toBe("PARTIALLY_RECEIVED");

    expect(await balance(acc.inventory!)).toBeCloseTo(inventory - 100, 4);
    expect(await balance(acc.grni!)).toBeCloseTo(grni + 100, 4); // a debit reduces the credit balance
    expect(await balance(acc.ppv!)).toBeCloseTo(0, 4);

    const line = (await orders.get(companyId, orderId)).lines[0]!;
    expect(line.receivedQuantity).toBe("3.0000");

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { companyId, itemId, movementType: "RETURN" } });
    expect(movement.quantity.toFixed(4)).toBe("-2.0000");
    expect(movement.value.toFixed(4)).toBe("100.0000");

    // Stock sub-ledger equals the Inventory control account (docs/05 §7).
    const stockValue = (await stockLevels.list(companyId, {})).reduce((sum, r) => sum + Number(r.value), 0);
    expect(await balance(acc.inventory!)).toBeCloseTo(stockValue, 4);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("books a cost difference to price variance, refuses cleanly while that account is unmapped, and can be received again", async () => {
    // Same item bought on two orders at different prices: weighted average is 110, but the second
    // order's receipt booked 120 per unit to GRNI.
    const first = await receivedOrder("10", "100", "10");
    const second = await receivedOrder("10", "120", "10", first.itemId);

    const stockBefore = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { itemId: first.itemId, warehouseId } });
    expect(stockBefore.value.toFixed(4)).toBe("2200.0000");

    // Unmapped variance account: one clear error, and nothing at all was changed.
    await expect(returns.create(returnInput(second.orderId, second.lineId, "10"), actor, cid(), newId())).rejects.toBeInstanceOf(UnmappedAccountError);
    const unchanged = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { itemId: first.itemId, warehouseId } });
    expect(unchanged.quantity.toFixed(4)).toBe("20.0000");
    expect((await orders.get(companyId, second.orderId)).lines[0]!.receivedQuantity).toBe("10.0000");
    expect(await prisma.goodsReturn.count({ where: { companyId, purchaseOrderId: second.orderId } })).toBe(0);

    await mappings.set("PURCHASE_PRICE_VARIANCE", acc.ppv!, actor, cid());
    const inventory = await balance(acc.inventory!);
    const grni = await balance(acc.grni!);
    const ppv = await balance(acc.ppv!);

    const result = await returns.create(returnInput(second.orderId, second.lineId, "10"), actor, cid(), newId());
    expect(result.orderStatus).toBe("APPROVED"); // nothing received any more

    // GRNI is debited what the receipt credited (1200); Inventory loses what actually left stock
    // (10 x 110 = 1100); the 100 difference is a credit to price variance.
    expect(await balance(acc.grni!)).toBeCloseTo(grni + 1200, 4);
    expect(await balance(acc.inventory!)).toBeCloseTo(inventory - 1100, 4);
    expect(await balance(acc.ppv!)).toBeCloseTo(ppv - 100, 4);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);

    const stockAfter = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { itemId: first.itemId, warehouseId } });
    expect(stockAfter.quantity.toFixed(4)).toBe("10.0000");
    expect(stockAfter.value.toFixed(4)).toBe("1100.0000");
    const stockValue = (await stockLevels.list(companyId, {})).reduce((sum, r) => sum + Number(r.value), 0);
    expect(await balance(acc.inventory!)).toBeCloseTo(stockValue, 4);

    // The returned quantity is receivable again.
    const again = await receiving.receive(
      second.orderId,
      { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: second.lineId, quantity: "10" }] },
      actor,
      cid(),
      newId(),
    );
    expect(again.orderStatus).toBe("RECEIVED");
  });

  it("refuses goods already matched to a supplier invoice, and allows exactly the uninvoiced remainder", async () => {
    const { orderId, lineId } = await receivedOrder("10", "40", "6");
    await invoices.create(
      { supplierId, supplierInvoiceNumber: "RET-INV-1", invoiceDate: today, lines: [{ kind: "PO_LINE", purchaseOrderLineId: lineId, quantity: "4", unitPrice: "40", taxCodeId: vat15 }] },
      actor,
      cid(),
      newId(),
    );

    // 6 received, 4 invoiced: only 2 can go back this way.
    await expect(returns.create(returnInput(orderId, lineId, "3"), actor, cid(), newId())).rejects.toMatchObject({ code: "OVER_RETURN" });
    expect((await orders.get(companyId, orderId)).lines[0]!.receivedQuantity).toBe("6.0000");

    const ok = await returns.create(returnInput(orderId, lineId, "2"), actor, cid(), newId());
    expect(ok.orderStatus).toBe("PARTIALLY_RECEIVED");
    await expect(returns.create(returnInput(orderId, lineId, "0.0001"), actor, cid(), newId())).rejects.toMatchObject({ code: "OVER_RETURN" });
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("refuses a return when the chosen warehouse does not hold the goods, leaving everything untouched", async () => {
    const { orderId, lineId } = await receivedOrder("4", "10", "4");
    await expect(returns.create(returnInput(orderId, lineId, "1", emptyWarehouseId), actor, cid(), newId())).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await orders.get(companyId, orderId)).lines[0]!.receivedQuantity).toBe("4.0000");
    expect(await prisma.goodsReturn.count({ where: { companyId, purchaseOrderId: orderId } })).toBe(0);
  });

  it("validates the request: empty, unknown order, order with nothing received, line from another order, other company", async () => {
    const { orderId, lineId } = await receivedOrder("2", "10", "2");
    const other = await receivedOrder("2", "10", "2");

    await expect(returns.create({ purchaseOrderId: orderId, warehouseId, documentDate: today, lines: [] }, actor, cid(), newId())).rejects.toMatchObject({ code: "EMPTY_RETURN" });
    await expect(returns.create(returnInput(newId(), lineId, "1"), actor, cid(), newId())).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(returns.create(returnInput(orderId, other.lineId, "1"), actor, cid(), newId())).rejects.toMatchObject({ code: "LINE_NOT_ON_ORDER" });
    await expect(returns.create(returnInput(orderId, lineId, "1"), { id: "x", companyId: newId() }, cid(), newId())).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });

    const idle = await orders.create({ supplierId, warehouseId, orderDate: today, lines: [{ itemId: other.itemId, quantity: "1", unitPrice: "10", taxCodeId: vat15 }] }, actor, cid());
    const idleLine = (await orders.get(companyId, idle.id)).lines[0]!.id;
    await expect(returns.create(returnInput(idle.id, idleLine, "1"), actor, cid(), newId())).rejects.toBeInstanceOf(GoodsReturnError);
    await expect(returns.create(returnInput(idle.id, idleLine, "1"), actor, cid(), newId())).rejects.toMatchObject({ code: "ORDER_NOT_RETURNABLE" });
  });

  it("lets only one of two simultaneous returns of the last unit through", async () => {
    const { orderId, lineId } = await receivedOrder("1", "10", "1");
    const results = await Promise.allSettled([
      returns.create(returnInput(orderId, lineId, "1"), actor, cid(), newId()),
      returns.create(returnInput(orderId, lineId, "1"), actor, cid(), newId()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    // The loser waits for the order's row lock, then sees the committed result. Returning the last
    // unit sends the order back to APPROVED, so the refusal is ORDER_NOT_RETURNABLE; with other lines
    // still received it would be OVER_RETURN. Either is the correct clean refusal.
    expect(["OVER_RETURN", "ORDER_NOT_RETURNABLE"]).toContain((failed.reason as GoodsReturnError).code);
    expect(await prisma.goodsReturn.count({ where: { companyId, purchaseOrderId: orderId } })).toBe(1);
    expect((await orders.get(companyId, orderId)).lines[0]!.receivedQuantity).toBe("0.0000");
  });

  it("lists returns with their lines for the company only", async () => {
    const page = await returns.list(companyId, { limit: "100" });
    expect(page.data.length).toBeGreaterThanOrEqual(3);
    const first = page.data[0]!;
    expect(first.supplierName).toBe("Supplier Co");
    expect(first.lines.length).toBeGreaterThan(0);
    expect((await returns.list(newId(), {})).data).toHaveLength(0);
    expect((await returns.list(companyId, { limit: "1" })).pageInfo.nextCursor).not.toBeNull();
  });

  it("reads one return back with its lines and journal entry, and nothing for another company", async () => {
    const first = (await returns.list(companyId, { limit: "1" })).data[0]!;
    const detail = (await returns.get(first.id, companyId))!;
    expect(detail).toMatchObject({ number: first.number, totalValue: first.totalValue, purchaseOrderNumber: first.purchaseOrderNumber });
    expect(detail.lines).toEqual(first.lines);
    expect(await prisma.journalEntry.count({ where: { id: detail.journalEntryId, companyId } })).toBe(1);
    expect(await returns.get(first.id, newId())).toBeNull();
    expect(await returns.get(newId(), companyId)).toBeNull();
  });
});
