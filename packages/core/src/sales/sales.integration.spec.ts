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
import { StockMovementService } from "../inventory/stock-movement.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { QuotationService } from "./quotation.service.js";
import { SalesInvoiceService } from "./sales-invoice.service.js";
import { SalesOrderService } from "./sales-order.service.js";
import { DocumentTrailService } from "../documents/document-trail.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Sales (M6, quotation to invoice) — real database", () => {
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
  const quotations = new QuotationService(prisma, audit);
  const orders = new SalesOrderService(prisma, audit);
  const invoices = new SalesInvoiceService(prisma, engine, mappings, audit);

  const companyId = newId();
  const actor = { id: "sales", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let acc: Record<string, string>;
  let warehouseId: string;
  let itemId: string;
  let customerId: string;
  let vat15: string;
  let vat0: string;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Sales Test ${companyId}`, defaultCurrency: "SAR" } });
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
      ar: await make("1200", "Accounts receivable", "ASSET", "DEBIT"),
      revenue: await make("4100", "Sales", "REVENUE", "CREDIT"),
      services: await make("4200", "Service revenue", "REVENUE", "CREDIT"),
      vat: await make("2300", "Output VAT", "LIABILITY", "CREDIT"),
      cogs: await make("5100", "Cost of goods sold", "EXPENSE", "DEBIT"),
    };
    await mappings.set("INVENTORY", acc.inventory!, actor, cid());
    await mappings.set("GRNI", acc.grni!, actor, cid());
    await mappings.set("ACCOUNTS_RECEIVABLE", acc.ar!, actor, cid());
    await mappings.set("SALES_REVENUE", acc.revenue!, actor, cid());
    await mappings.set("VAT_OUTPUT", acc.vat!, actor, cid());
    await mappings.set("COST_OF_GOODS_SOLD", acc.cogs!, actor, cid());

    const codes = await taxCodes.addSaudiDefaults(actor, cid());
    vat15 = codes.find((c) => c.code === "VAT15")!.id;
    vat0 = codes.find((c) => c.code === "VAT0")!.id;

    warehouseId = (await warehouses.create({ code: "WH1", name: "Main" }, actor, cid())).id;
    itemId = (await items.create({ code: "CEM", name: "Cement", unit: "BAG" }, actor, cid())).id;
    customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C1-${companyId.slice(0, 6)}`, companyId, name: "Customer Co", nameAr: "شركة العميل", kind: "COMPANY" } })).id;

    await receipts.create({ warehouseId, documentDate: today, lines: [{ itemId, quantity: "10", unitCost: "50" }] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let orderId: string;
  let itemLineId: string;
  let serviceLineId: string;
  let invoiceId: string;




  it("turns a quotation into an order with the same lines, once", async () => {
    const quote = await quotations.create(
      {
        customerId,
        quotationDate: today,
        lines: [
          { itemId, quantity: "4", unitPrice: "100", taxCodeId: vat15 },
          { description: "Delivery", quantity: "1", unitPrice: "200", taxCodeId: vat0 },
        ],
      },
      actor,
      cid(),
    );
    expect(quote.number).toMatch(/^QUO-.*-000001$/);
    expect(quote.totalGross).toBe("660.0000"); // 400 + 60 VAT + 200

    const order = await orders.createFromQuotation(quote.id, today, actor, cid());
    orderId = order.id;
    expect(order.number).toMatch(/^SO-.*-000001$/);
    expect((await quotations.get(companyId, quote.id)).status).toBe("CONVERTED");
    await expect(orders.createFromQuotation(quote.id, today, actor, cid())).rejects.toMatchObject({ code: "INVALID_STATE" });

    const detail = await orders.get(companyId, orderId);
    expect(detail.totalGross).toBe("660.0000");
    itemLineId = detail.lines.find((l) => l.itemId === itemId)!.id;
    serviceLineId = detail.lines.find((l) => l.itemId === null)!.id;
  });

  it("invoices part of an order: revenue, output VAT, receivable, and cost of goods sold out of stock", async () => {
    const ar = await balance(acc.ar!);
    const revenue = await balance(acc.revenue!);
    const vat = await balance(acc.vat!);
    const cogs = await balance(acc.cogs!);

    const result = await invoices.createInvoice(
      { customerId, invoiceDate: today, lines: [{ itemId, warehouseId, salesOrderLineId: itemLineId, quantity: "3", unitPrice: "100", taxCodeId: vat15 }] },
      actor,
      cid(),
      newId(),
    );
    invoiceId = result.id;
    expect(result.number).toMatch(/^INV-.*-000001$/);
    expect(result.totalGross).toBe("345.0000");
    const card = await new StockMovementService(prisma).list(companyId, { itemId });
    expect(card.data.find((m) => m.sourceDocumentType === "sales_invoice")).toMatchObject({ partyName: "Customer Co", partyNameAr: "شركة العميل" });
    expect(card.data.find((m) => m.sourceDocumentType === "goods_receipt")).toMatchObject({ partyName: null, partyNameAr: null });

    expect(await balance(acc.ar!)).toBeCloseTo(ar + 345, 4);
    expect(await balance(acc.revenue!)).toBeCloseTo(revenue - 300, 4);
    expect(await balance(acc.vat!)).toBeCloseTo(vat - 45, 4);
    expect(await balance(acc.cogs!)).toBeCloseTo(cogs + 150, 4); // 3 x 50
    expect((await stockLevels.list(companyId, { itemId }))[0]).toMatchObject({ quantity: "7.0000", value: "350.0000" });
    expect((await orders.get(companyId, orderId)).status).toBe("PARTIALLY_INVOICED");

    // Stock sub-ledger still equals the Inventory control account.
    expect(await balance(acc.inventory!)).toBeCloseTo(350, 4);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("refuses more than the order has left, and more than the warehouse holds, leaving nothing behind", async () => {
    await expect(
      invoices.createInvoice(
        { customerId, invoiceDate: today, lines: [{ itemId, warehouseId, salesOrderLineId: itemLineId, quantity: "2", unitPrice: "100", taxCodeId: vat15 }] },
        actor,
        cid(),
        newId(),
      ),
    ).rejects.toMatchObject({ code: "OVER_INVOICED", lineNumber: 1 });

    await expect(
      invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId, warehouseId, quantity: "100", unitPrice: "1", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", lineNumber: 1 });

    expect((await stockLevels.list(companyId, { itemId }))[0]?.quantity).toBe("7.0000");
    expect((await orders.get(companyId, orderId)).lines.find((l) => l.id === itemLineId)?.invoicedQuantity).toBe("3.0000");
  });

  it("finishes the order with the rest, posts a service line to its own revenue account, and closes the order", async () => {
    const services = await balance(acc.services!);
    const result = await invoices.createInvoice(
      {
        customerId,
        invoiceDate: today,
        lines: [
          { itemId, warehouseId, salesOrderLineId: itemLineId, quantity: "1", unitPrice: "100", taxCodeId: vat15 },
          { description: "Delivery", salesOrderLineId: serviceLineId, revenueAccountId: acc.services!, quantity: "1", unitPrice: "200", taxCodeId: vat0 },
        ],
      },
      actor,
      cid(),
      newId(),
    );
    expect(result.totalGross).toBe("315.0000"); // 100 + 15 VAT + 200
    expect(await balance(acc.services!)).toBeCloseTo(services - 200, 4);
    expect((await orders.get(companyId, orderId)).status).toBe("INVOICED");

    await expect(
      invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ description: "x", salesOrderLineId: serviceLineId, quantity: "1", unitPrice: "1", taxCodeId: vat0 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("credits an invoice in part, never beyond its value, and reduces the receivable", async () => {
    const ar = await balance(acc.ar!);
    const note = await invoices.createCreditNote(
      { originalInvoiceId: invoiceId, creditDate: today, lines: [{ description: "Damaged bag", quantity: "1", unitPrice: "100", taxCodeId: vat15 }] },
      actor,
      cid(),
      newId(),
    );
    expect(note.number).toMatch(/^CN-.*-000001$/);
    expect(note.totalGross).toBe("115.0000");
    expect(await balance(acc.ar!)).toBeCloseTo(ar - 115, 4);

    // The invoice was 345; 115 is credited, so at most 230 more.
    await expect(
      invoices.createCreditNote({ originalInvoiceId: invoiceId, creditDate: today, lines: [{ description: "Too much", quantity: "1", unitPrice: "300", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "CREDIT_EXCEEDS_INVOICE" });
    await expect(
      invoices.createCreditNote({ originalInvoiceId: note.id, creditDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "NOT_AN_INVOICE" });
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("debits an invoice in part, never beyond its value, and increases the receivable", async () => {
    const ar = await balance(acc.ar!);
    const note = await invoices.createDebitNote(
      { originalInvoiceId: invoiceId, debitDate: today, lines: [{ description: "Extra freight", quantity: "1", unitPrice: "100", taxCodeId: vat15 }] },
      actor,
      cid(),
      newId(),
    );
    expect(note.number).toMatch(/^SDN-.*-000001$/);
    expect(note.totalGross).toBe("115.0000");
    expect(await balance(acc.ar!)).toBeCloseTo(ar + 115, 4);

    // The invoice was 345; 115 is debited, so at most 230 more (debit notes are capped against the
    // invoice's own gross, independent of any credit notes already raised against it).
    await expect(
      invoices.createDebitNote({ originalInvoiceId: invoiceId, debitDate: today, lines: [{ description: "Too much", quantity: "1", unitPrice: "300", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "DEBIT_EXCEEDS_INVOICE" });
    await expect(
      invoices.createDebitNote({ originalInvoiceId: note.id, debitDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "NOT_AN_INVOICE" });
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("keeps companies apart", async () => {
    const stranger = { id: "stranger", companyId: newId() };
    await expect(invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }] }, stranger, cid(), newId())).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
    await expect(quotations.get(stranger.companyId, orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retries quotation and order creation concurrently without allocating duplicate documents", async () => {
    const lines = [{ description: "Retry test", quantity: "1", unitPrice: "10", taxCodeId: vat15 }];
    const quoteKey = newId(), orderKey = newId();
    const quotes = await Promise.all([1, 2].map(() => quotations.create({ customerId, quotationDate: today, lines }, actor, cid(), quoteKey)));
    expect(quotes[0]!.id).toBe(quotes[1]!.id);
    expect(await prisma.auditLog.count({ where: { entityId: quotes[0]!.id, action: "quotation.created" } })).toBe(1);
    const copies = await Promise.all([1, 2].map(() => orders.create({ customerId, orderDate: today, lines }, actor, cid(), orderKey)));
    expect(copies[0]!.id).toBe(copies[1]!.id);
    const converted = await orders.createFromQuotation(quotes[0]!.id, today, actor, cid());
    const trail = new DocumentTrailService(prisma, { can: () => Promise.resolve(true) });
    const graph = await trail.trail("quotation", quotes[0]!.id, actor);
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([quotes[0]!.id, converted.id]));
    await expect(trail.trail("quotation", quotes[0]!.id, { ...actor, companyId: newId() })).rejects.toThrow("NOT_FOUND");
    const restricted = new DocumentTrailService(prisma, { can: (_id, _action, resource) => Promise.resolve(resource === "quotation") });
    const limited = await restricted.trail("quotation", quotes[0]!.id, actor);
    expect(limited.nodes).toHaveLength(1);
    expect(limited.edges).toHaveLength(0);
  });
  it("returns partial stock at historical cost, uses original tax/account and replays without duplicate movements", async () => {
    const item = (await items.create({ code: "RET-S", name: "Return test", unit: "EA" }, actor, cid())).id;
    await receipts.create({ warehouseId, documentDate: today, lines: [{ itemId: item, quantity: "3", unitCost: "10.3333" }] }, actor, cid(), newId());
    const sale = await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId: item, warehouseId, quantity: "3", unitPrice: "20.1234", taxCodeId: vat15, revenueAccountId: acc.services! }] }, actor, cid(), newId());
    const source = (await invoices.get(companyId, sale.id)).lines[0]!;
    const line = { originalLineId: source.id, quantity: "1", description: "ignored", unitPrice: "999", taxCodeId: vat0 };
    const input = { originalInvoiceId: sale.id, creditDate: today, lines: [line] };
    const key = newId();
    const first = await invoices.createCreditNote(input, actor, cid(), key);
    expect(await invoices.createCreditNote(input, actor, cid(), key)).toEqual(first);
    expect(await prisma.stockMovement.count({ where: { sourceDocumentId: first.id } })).toBe(1);
    const stored = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { salesInvoiceId: first.id } });
    expect(stored.unitPrice.toFixed(4)).toBe("20.1234");
    expect(stored.taxCodeId).toBe(vat15);
    expect(stored.revenueAccountId).toBe(acc.services);
    expect((await invoices.get(companyId, sale.id)).lines[0]!.returnableQuantity).toBe("2.0000");
    const outcomes = await Promise.allSettled([1, 2].map(() => invoices.createCreditNote({ ...input, lines: [{ ...line, quantity: "2" }] }, actor, cid(), newId())));
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    const stock = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { companyId, itemId: item, warehouseId } });
    expect(stock.quantity.toFixed(4)).toBe("3.0000");
    expect(stock.value.toFixed(4)).toBe("30.9999");
    const credits = await prisma.salesInvoice.aggregate({ where: { originalInvoiceId: sale.id }, _sum: { totalGross: true } });
    expect(credits._sum.totalGross!.toFixed(4)).toBe(sale.totalGross);
    await expect(invoices.createCreditNote(input, actor, cid(), newId())).rejects.toMatchObject({ code: "OVER_RETURN" });
    await expect(invoices.createCreditNote(input, { ...actor, companyId: newId() }, cid(), newId())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restores stock into the selected warehouse at the original cost and records the destination", async () => {
    const destination = (await warehouses.create({ code: "RET-WH", name: "Returns", nameAr: "مخزن المرتجعات" }, actor, cid())).id;
    const item = (await items.create({ code: "RET-DEST", name: "Destination return", unit: "EA" }, actor, cid())).id;
    await receipts.create({ warehouseId, documentDate: today, lines: [{ itemId: item, quantity: "3", unitCost: "10" }] }, actor, cid(), newId());
    await receipts.create({ warehouseId: destination, documentDate: today, lines: [{ itemId: item, quantity: "1", unitCost: "30" }] }, actor, cid(), newId());
    const sale = await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId: item, warehouseId, quantity: "3", unitPrice: "20", taxCodeId: vat15 }] }, actor, cid(), newId());
    const source = (await invoices.get(companyId, sale.id)).lines[0]!;
    expect(source).toMatchObject({ itemId: item, warehouseId, warehouseName: "Main" });
    const line = { originalLineId: source.id, warehouseId: destination, quantity: "1", description: "Return", unitPrice: "20", taxCodeId: vat15 };
    const input = { originalInvoiceId: sale.id, creditDate: today, lines: [line] };
    const key = newId();
    const note = await invoices.createCreditNote(input, actor, cid(), key);
    expect(await invoices.createCreditNote(input, actor, cid(), key)).toEqual(note);
    const stock = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { companyId, itemId: item, warehouseId: destination } });
    expect(stock.quantity.toFixed(4)).toBe("2.0000");
    expect(stock.value.toFixed(4)).toBe("40.0000");
    const originalStock = await prisma.itemWarehouseStock.findFirstOrThrow({ where: { companyId, itemId: item, warehouseId } });
    expect(originalStock.quantity.toFixed(4)).toBe("0.0000");
    expect((await invoices.get(companyId, note.id)).lines[0]).toMatchObject({ itemId: item, warehouseId: destination, warehouseName: "Returns", warehouseNameAr: "مخزن المرتجعات" });
    const moves = await prisma.stockMovement.findMany({ where: { sourceDocumentId: note.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.warehouseId).toBe(destination);
    const journal = await prisma.journalEntryLine.findMany({ where: { journalEntryId: note.journalEntryId, accountId: acc.inventory! } });
    expect(journal[0]!.debit.toFixed(4)).toBe("10.0000");
    await invoices.createCreditNote({ ...input, lines: [{ ...line, warehouseId, quantity: "2" }] }, actor, cid(), newId());
    await expect(invoices.createCreditNote(input, actor, cid(), newId())).rejects.toMatchObject({ code: "OVER_RETURN" });
    expect((await prisma.itemWarehouseStock.findFirstOrThrow({ where: { companyId, itemId: item, warehouseId } })).quantity.toFixed(4)).toBe("2.0000");
  });

  it("rejects invalid, inactive and foreign warehouses without posting any return", async () => {
    const inactive = (await warehouses.create({ code: "INACTIVE-RET", name: "Inactive" }, actor, cid())).id;
    await prisma.warehouse.update({ where: { id: inactive }, data: { isActive: false } });
    const foreignCompany = await prisma.company.create({ data: { id: newId(), name: "Foreign return company" } });
    const foreign = (await warehouses.create({ code: "FOREIGN", name: "Foreign" }, { ...actor, companyId: foreignCompany.id }, cid())).id;
    const item = (await items.create({ code: "RET-INVALID", name: "Invalid destination", unit: "EA" }, actor, cid())).id;
    await receipts.create({ warehouseId, documentDate: today, lines: [{ itemId: item, quantity: "1", unitCost: "10" }] }, actor, cid(), newId());
    const sale = await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId: item, warehouseId, quantity: "1", unitPrice: "20", taxCodeId: vat15 }] }, actor, cid(), newId());
    const source = (await invoices.get(companyId, sale.id)).lines[0]!;
    for (const destination of [newId(), inactive, foreign]) {
      await expect(invoices.createCreditNote({ originalInvoiceId: sale.id, creditDate: today, lines: [{ originalLineId: source.id, warehouseId: destination, quantity: "1", description: "Return", unitPrice: "20", taxCodeId: vat15 }] }, actor, cid(), newId())).rejects.toMatchObject({ code: "WAREHOUSE_NOT_FOUND" });
    }
    expect(await prisma.salesInvoice.count({ where: { originalInvoiceId: sale.id } })).toBe(0);
    expect((await invoices.get(companyId, sale.id)).lines[0]!.returnableQuantity).toBe("1.0000");
    expect((await prisma.itemWarehouseStock.findFirstOrThrow({ where: { companyId, itemId: item, warehouseId } })).quantity.toFixed(4)).toBe("0.0000");
  });

  it("rejects duplicate source lines and a line from another sales invoice atomically", async () => {
    const sale = await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ description: "Service", quantity: "2", unitPrice: "10", taxCodeId: vat0 }] }, actor, cid(), newId());
    const source = (await invoices.get(companyId, sale.id)).lines[0]!;
    const line = { originalLineId: source.id, quantity: "1", description: "Service", unitPrice: "10", taxCodeId: vat0 };
    await expect(invoices.createCreditNote({ originalInvoiceId: sale.id, creditDate: today, lines: [line, line] }, actor, cid(), newId())).rejects.toMatchObject({ code: "INVALID_RETURN" });
    await expect(invoices.createCreditNote({ originalInvoiceId: sale.id, creditDate: today, lines: [{ ...line, originalLineId: newId() }] }, actor, cid(), newId())).rejects.toMatchObject({ code: "INVALID_RETURN" });
    expect(await prisma.salesInvoice.count({ where: { originalInvoiceId: sale.id } })).toBe(0);
    await expect(invoices.createCreditNote({ originalInvoiceId: sale.id, creditDate: today, lines: [{ ...line, warehouseId }] }, actor, cid(), newId())).rejects.toMatchObject({ code: "INVALID_RETURN" });
    const note = await invoices.createCreditNote({ originalInvoiceId: sale.id, creditDate: today, lines: [{ ...line, revenueAccountId: acc.services! }] }, actor, cid(), newId());
    const returned = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { salesInvoiceId: note.id } });
    expect(returned.revenueAccountId).toBeNull();
    const entry = await prisma.journalEntryLine.findFirstOrThrow({ where: { journalEntryId: note.journalEntryId, accountId: acc.revenue! } });
    expect(entry.debit.toFixed(4)).toBe("10.0000");
  });


});

// docs/01-OPEN-DECISIONS.md: which ZATCA issuing unit (EgsUnit) a sales document belongs to. A
// separate, isolated company so the EgsUnit count here never affects the suite above.
describeIfDb("Sales invoices — ZATCA issuing unit (EgsUnit) resolution — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const mappings = new AccountMappingService(prisma, audit);
  const taxCodes = new TaxCodeService(prisma, audit);
  const invoices = new SalesInvoiceService(prisma, engine, mappings, audit);

  const companyId = newId();
  const actor = { id: "sales", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let customerId: string;
  let vat0: string;
  let invoiceId: string;

  async function makeEgsUnit(isActive: boolean): Promise<string> {
    // uuidv7's leading characters are time-based, not random -- units created close together in
    // this test would collide on the (companyId, serial) unique constraint if the serial used
    // `id.slice(0, N)`; the id's own randomness is at the END, so the full id is used instead.
    const id = newId();
    await prisma.egsUnit.create({
      data: { id, companyId, name: `EGS ${id}`, serial: `1-test|2-test|3-${id}`, businessCategory: "Retail", invoiceTypes: "1100", environment: "sandbox", isActive },
    });
    return id;
  }

  function invoice(lines: readonly { readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly taxCodeId: string }[], egsUnitId?: string) {
    return invoices.createInvoice({ customerId, invoiceDate: today, ...(egsUnitId !== undefined ? { egsUnitId } : {}), lines }, actor, cid(), newId());
  }

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Sales EGS Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance } })).id;
    const ar = await make("1200", "Accounts receivable", "ASSET", "DEBIT");
    const revenue = await make("4100", "Sales", "REVENUE", "CREDIT");
    const vat = await make("2300", "Output VAT", "LIABILITY", "CREDIT");
    await mappings.set("ACCOUNTS_RECEIVABLE", ar, actor, cid());
    await mappings.set("SALES_REVENUE", revenue, actor, cid());
    await mappings.set("VAT_OUTPUT", vat, actor, cid());
    vat0 = (await taxCodes.addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT0")!.id;
    customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C1-${companyId.slice(0, 6)}`, companyId, name: "Customer Co", kind: "COMPANY" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("assigns no unit when the company has none yet (ordinary invoicing, unaffected)", async () => {
    const result = await invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }]);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: result.id } })).egsUnitId).toBeNull();
  });

  it("assigns the single active unit automatically", async () => {
    const unitId = await makeEgsUnit(true);
    const result = await invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }]);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: result.id } })).egsUnitId).toBe(unitId);
  });

  it("requires an explicit choice with more than one active unit, and accepts the one chosen", async () => {
    const second = await makeEgsUnit(true);
    await expect(invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }])).rejects.toMatchObject({ code: "EGS_UNIT_REQUIRED" });
    const result = await invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }], second);
    invoiceId = result.id;
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: result.id } })).egsUnitId).toBe(second);
  });

  it("refuses a chosen unit that is not active or not this company's", async () => {
    const inactive = await makeEgsUnit(false);
    await expect(invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }], inactive)).rejects.toMatchObject({ code: "EGS_UNIT_NOT_FOUND" });
    await expect(invoice([{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }], newId())).rejects.toMatchObject({ code: "EGS_UNIT_NOT_FOUND" });
  });

  it("a credit note inherits its original invoice's unit by default", async () => {
    const note = await invoices.createCreditNote({ originalInvoiceId: invoiceId, creditDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }] }, actor, cid(), newId());
    const original = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: note.id } })).egsUnitId).toBe(original.egsUnitId);
  });


  it("records invoice numbers, counterparty, decimal totals and lines in posting audit events", async () => {
    const documents = await prisma.salesInvoice.findMany({ where: { companyId }, select: { id: true } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: { in: documents.map((d) => d.id) }, actorId: actor.id, entityType: "SalesInvoice", action: "sales_invoice.posted", afterJson: { path: ["currency"], equals: "SAR" } }, orderBy: { createdAt: "desc" } });
    const snapshot = row.afterJson as Record<string, unknown>;
    expect(snapshot.currency).toBe("SAR");
    for (const field of ["number", "customerName", "totalNet", "totalTax", "totalGross", "journalEntryId"]) expect(typeof snapshot[field]).toBe("string");
    expect(snapshot.totalNet).toMatch(/^-?\d+\.\d{4}$/);
    expect(Array.isArray(snapshot.lines)).toBe(true);
    const lines = snapshot.lines as Record<string, unknown>[];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (const field of ["quantity", "unitPrice", "netAmount", "taxAmount"]) expect(typeof line[field]).toBe("string");
  });

});
