import { Prisma, PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { GoodsReceiptService } from "../inventory/goods-receipt.service.js";
import { StockIssueService } from "../inventory/stock-issue.service.js";
import { StockLevelService } from "../inventory/stock-level.service.js";
import { StockCountService } from "../inventory/stock-count.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { ItemService } from "../inventory/item.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { QuotationService } from "./quotation.service.js";
import { SalesOrderService } from "./sales-order.service.js";
import { SalesInvoiceService } from "./sales-invoice.service.js";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb("Sales pricing and provisional inventory cost", () => {
  const p = new PrismaClient();
  const audit = new PrismaAuditLogger(p);
  const numbering = new PrismaNumberingService();
  const engine = new PrismaAccountingEngine(p, numbering);
  const mappings = new AccountMappingService(p, audit);
  const receipts = new GoodsReceiptService(p, engine, mappings, audit);
  const issues = new StockIssueService(p, engine, mappings, audit);
  const counts = new StockCountService(p, engine, numbering, mappings, audit);
  const invoices = new SalesInvoiceService(p, engine, mappings, audit);
  const quotes = new QuotationService(p, audit);
  const orders = new SalesOrderService(p, audit);
  const levels = new StockLevelService(p);
  const companyId = newId(), actor = { id: "policy-test", companyId }, date = new Date();
  let warehouseId: string, customerId: string, taxCodeId: string;
  const accounts: Record<string, string> = {};
  beforeAll(async () => {
    const year = date.getUTCFullYear();
    await p.company.create({ data: { id: companyId, name: "Policy test", defaultCurrency: "SAR" } });
    const fy = await p.fiscalYear.create({ data: { id: newId(), companyId, name: `FY${year}`, startDate: new Date(Date.UTC(year,0,1)), endDate: new Date(Date.UTC(year,11,31)) } });
    await p.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: 1, startDate: fy.startDate, endDate: fy.endDate } });
    const types = { INVENTORY: "ASSET", GRNI: "LIABILITY", ACCOUNTS_RECEIVABLE: "ASSET", SALES_REVENUE: "REVENUE", VAT_OUTPUT: "LIABILITY", COST_OF_GOODS_SOLD: "EXPENSE", PROJECT_ISSUE_EXPENSE: "EXPENSE", COUNT_GAIN: "REVENUE", COUNT_LOSS: "EXPENSE" } as const;
    for (const [key, type] of Object.entries(types)) {
      const id = newId();
      await p.account.create({ data: { id, companyId, ref: id, code: String(Object.keys(accounts).length + 100), name: key, type, normalBalance: ["ASSET","EXPENSE"].includes(type) ? "DEBIT" : "CREDIT" } });
      accounts[key] = id;
      await mappings.set(key as keyof typeof types, id, actor, newId());
    }
    warehouseId = (await new WarehouseService(p,audit).create({ code: "MAIN", name: "Main" }, actor,newId())).id;
    customerId = (await p.party.create({ data: { id: newId(), ref: newId(), companyId, name: "Customer", kind: "CUSTOMER" } })).id;
    taxCodeId = (await new TaxCodeService(p,audit).addSaudiDefaults(actor,newId())).find((t) => t.code === "VAT15")!.id;
  });
  afterAll(async () => p.$disconnect());
  const item = async () => (await new ItemService(p,audit).create({ code: newId(), name: "Policy item", unit: "EA" }, actor,newId())).id;
  const receive = (itemId: string, quantity: string, unitCost: string) => receipts.create({ warehouseId, documentDate: date, lines: [{ itemId, quantity, unitCost }] },actor,newId(),newId());
  const sell = (itemId: string, quantity: string, unitPrice = "100") => invoices.createInvoice({ customerId, invoiceDate: date, lines: [{ itemId, warehouseId, quantity, unitPrice, taxCodeId }] },actor,newId(),newId());
  const stock = (itemId: string) => p.itemWarehouseStock.findFirstOrThrow({ where: { companyId,itemId,warehouseId } });
  async function balance(key: string) {
    const sums = await p.journalEntryLine.aggregate({ where: { accountId: accounts[key]!, journalEntry: { companyId } }, _sum: { debit: true,credit: true } });
    return (sums._sum.debit ?? new Prisma.Decimal(0)).minus(sums._sum.credit ?? 0);
  }
  async function reconcile() {
    const total = await p.itemWarehouseStock.aggregate({ where: { companyId }, _sum: { value: true } });
    expect((await balance("INVENTORY")).toFixed(4)).toBe(total._sum.value?.toFixed(4) ?? "0.0000");
    const lines = await p.journalEntryLine.aggregate({ where: { journalEntry: { companyId } }, _sum: { debit: true,credit: true } });
    expect(lines._sum.debit?.toFixed(4)).toBe(lines._sum.credit?.toFixed(4));
  }

  it("rejects below-cost quotations and direct orders before they are saved, including depleted stock", async () => {
    const id = await item(); await receive(id,"2","10");
    const lines = [{ itemId: id,quantity: "100",unitPrice: "9",taxCodeId }];
    await expect(quotes.create({ customerId,quotationDate: date,lines },actor,newId())).rejects.toMatchObject({ code: "BELOW_COST",lineNumber: 1 });
    await expect(orders.create({ customerId,orderDate: date,lines },actor,newId())).rejects.toMatchObject({ code: "BELOW_COST" });
    await sell(id,"2");
    await expect(quotes.create({ customerId,quotationDate: date,lines },actor,newId())).rejects.toMatchObject({ code: "BELOW_COST" });
    expect(await p.quotation.count({ where: { companyId } })).toBe(0);
    await reconcile();
  });

  it("preserves quote prices through conversion and invoices despite later cost changes", async () => {
    const id = await item(); await receive(id,"1","10");
    const quote = await quotes.create({ customerId,quotationDate: date,lines: [{ itemId: id,quantity: "3",unitPrice: "10",taxCodeId }] },actor,newId());
    const order = await orders.createFromQuotation(quote.id,date,actor,newId());
    const source = (await orders.get(companyId,order.id)).lines[0]!;
    await receive(id,"1","30");
    const input = { customerId,invoiceDate: date,lines: [{ itemId: id,warehouseId,salesOrderLineId: source.id,quantity: "3",unitPrice: "10",taxCodeId }] };
    await expect(invoices.createInvoice({ ...input,lines: [{ ...input.lines[0]!,unitPrice: "11" }] },actor,newId(),newId())).rejects.toMatchObject({ code: "ORDER_LINE_MISMATCH" });
    const other = await item();
    await expect(invoices.createInvoice({ ...input,lines: [{ ...input.lines[0]!,itemId: other }] },actor,newId(),newId())).rejects.toMatchObject({ code: "ORDER_LINE_MISMATCH" });
    const invoice = await invoices.createInvoice(input,actor,newId(),newId());
    expect((await invoices.get(companyId,invoice.id)).lines[0]!.unitPrice).toBe("10.0000");
    expect((await stock(id)).quantity.toFixed(4)).toBe("-1.0000");
    await reconcile();
  });

  it("settles higher and lower actual costs on partial receipts without changing the original entry", async () => {
    const id = await item(); await receive(id,"2","10");
    const before = await balance("COST_OF_GOODS_SOLD");
    const invoice = await sell(id,"5");
    const entry = await p.journalEntryLine.findMany({ where: { journalEntryId: invoice.journalEntryId },orderBy: { id: "asc" } });
    expect((await stock(id)).value.toFixed(4)).toBe("-30.0000");
    expect((await invoices.get(companyId,invoice.id)).stockCostStatus).toBe("PROVISIONAL");
    await receive(id,"1","12");
    expect((await balance("COST_OF_GOODS_SOLD")).minus(before).toFixed(4)).toBe("52.0000");
    expect((await stock(id)).value.toFixed(4)).toBe("-20.0000");
    await receive(id,"4","8");
    expect((await balance("COST_OF_GOODS_SOLD")).minus(before).toFixed(4)).toBe("48.0000");
    expect((await stock(id)).quantity.toFixed(4)).toBe("2.0000");
    expect((await stock(id)).value.toFixed(4)).toBe("16.0000");
    expect((await invoices.get(companyId,invoice.id)).stockCostStatus).toBe("FINAL");
    expect(await p.journalEntryLine.findMany({ where: { journalEntryId: invoice.journalEntryId },orderBy: { id: "asc" } })).toEqual(entry);
    await reconcile();
  });

  it("keeps unknown costs pending and recognizes them when actual receipts arrive", async () => {
    const id = await item(), before = await balance("COST_OF_GOODS_SOLD");
    const invoice = await sell(id,"3");
    expect((await invoices.get(companyId,invoice.id)).stockCostStatus).toBe("PENDING");
    expect((await stock(id)).value.toFixed(4)).toBe("0.0000");
    await receive(id,"2","7");
    expect((await levels.list(companyId,{itemId:id}))[0]!.costStatus).toBe("PENDING");
    await receive(id,"1","8");
    expect((await balance("COST_OF_GOODS_SOLD")).minus(before).toFixed(4)).toBe("22.0000");
    expect((await stock(id)).value.toFixed(4)).toBe("0.0000");
    expect((await invoices.get(companyId,invoice.id)).stockCostStatus).toBe("FINAL");
    await reconcile();
  });

  it("allows an issue with no cost history and settles the project expense account", async () => {
    const id = await item(), before = await balance("PROJECT_ISSUE_EXPENSE");
    const issue = await issues.create({ warehouseId,documentDate: date,costCenterRef: "P1",lines: [{itemId:id,quantity:"2"}] },actor,newId(),newId());
    expect(issue.journalEntryId).toBeNull();
    expect((await issues.get(issue.id,companyId))?.stockCostStatus).toBe("PENDING");
    expect(await p.stockMovement.count({ where: { companyId,sourceDocumentId:issue.id,journalEntryId:null } })).toBe(1);
    await receive(id,"2","6");
    expect((await issues.get(issue.id,companyId))?.stockCostStatus).toBe("FINAL");
    expect((await balance("PROJECT_ISSUE_EXPENSE")).minus(before).toFixed(4)).toBe("12.0000");
    await reconcile();
  });

  it("replays unvalued issues and receipts without duplicating quantities or settlements", async () => {
    const id = await item(), key = newId();
    const input = { warehouseId,documentDate:date,costCenterRef:"P2",lines:[{itemId:id,quantity:"1"}] };
    const [first, second] = await Promise.all([issues.create(input,actor,newId(),key),issues.create(input,actor,newId(),key)]);
    expect(second).toEqual(first);
    expect((await stock(id)).quantity.toFixed(4)).toBe("-1.0000");
    const receiptKey = newId(), receipt = { warehouseId,documentDate:date,lines:[{itemId:id,quantity:"1",unitCost:"0"}] };
    const received = await receipts.create(receipt,actor,newId(),receiptKey);
    expect(received.journalEntryId).toBeNull();
    expect(await receipts.create(receipt,actor,newId(),receiptKey)).toEqual(received);
    expect((await stock(id)).quantity.toFixed(4)).toBe("0.0000");
    expect(await p.inventoryCostSettlement.count({where:{companyId,sourceDocumentId:received.id}})).toBe(1);
    await reconcile();
  });

  it("replays invoice issuance without another shortfall or stock movement", async () => {
    const id=await item(), key=newId();
    const input={customerId,invoiceDate:date,lines:[{itemId:id,warehouseId,quantity:"2",unitPrice:"10",taxCodeId}]};
    const first=await invoices.createInvoice(input,actor,newId(),key);
    expect(await invoices.createInvoice(input,actor,newId(),key)).toEqual(first);
    expect((await stock(id)).quantity.toFixed(4)).toBe("-2.0000");
    expect(await p.inventoryShortfall.count({where:{companyId,sourceDocumentId:first.id}})).toBe(1);
    await reconcile();
  });

  it("distributes sub-cent costs across several shortages without negative remainders", async () => {
    const id=await item(); await sell(id,"0.0001"); await sell(id,"0.0001"); await sell(id,"0.0001");
    await receive(id,"0.0003","0.3333");
    expect((await stock(id)).quantity.toFixed(4)).toBe("0.0000");
    expect((await stock(id)).value.toFixed(4)).toBe("0.0000");
    const s=await p.inventoryCostSettlement.findMany({where:{companyId,shortfall:{itemId:id}}});
    expect(s.reduce((sum,row)=>sum.plus(row.actualValue),new Prisma.Decimal(0)).toFixed(4)).toBe("0.0001");
    expect(s.every(row=>row.actualValue.greaterThanOrEqualTo(0))).toBe(true);
    await reconcile();
  });

  it("returns goods before and after settlement without leaving residual COGS", async () => {
    const id = await item(); await receive(id,"1","10");
    const before = await balance("COST_OF_GOODS_SOLD"), invoice = await sell(id,"4");
    const source = (await invoices.get(companyId,invoice.id)).lines[0]!;
    const credit = (quantity: string) => invoices.createCreditNote({ originalInvoiceId: invoice.id,creditDate:date,lines:[{originalLineId:source.id,warehouseId,description:"Return",quantity,unitPrice:"100",taxCodeId}] },actor,newId(),newId());
    await credit("1");
    await receive(id,"2","15");
    await credit("3");
    expect((await balance("COST_OF_GOODS_SOLD")).minus(before).toFixed(4)).toBe("0.0000");
    expect((await stock(id)).quantity.toFixed(4)).toBe("3.0000");
    expect((await stock(id)).value.toFixed(4)).toBe("40.0000");
    await reconcile();
  });

  it("rolls back negative stock and pending costs when posting fails", async () => {
    const id = await item();
    await expect(invoices.createInvoice({ customerId,invoiceDate:new Date("1900-01-01"),lines:[{itemId:id,warehouseId,quantity:"4",unitPrice:"20",taxCodeId}] },actor,newId(),newId())).rejects.toMatchObject({ code: "NO_OPEN_PERIOD" });
    expect(await p.itemWarehouseStock.count({ where: { companyId,itemId:id } })).toBe(0);
    expect(await p.inventoryShortfall.count({ where: { companyId,itemId:id } })).toBe(0);
    await reconcile();
  });

  it("clears negative stock by a physical count using the known reference cost", async () => {
    const id = await item(); await receive(id,"1","10"); await sell(id,"3");
    const count = await counts.record({ warehouseId,documentDate:date,lines:[{itemId:id,countedQuantity:"1"}] },actor,newId());
    await counts.post(count.id,actor,newId(),newId());
    expect((await stock(id)).quantity.toFixed(4)).toBe("1.0000");
    expect(await p.inventoryShortfall.count({ where: { companyId,itemId:id,remainingQuantity:{gt:0} } })).toBe(0);
    await reconcile();
  });
});
