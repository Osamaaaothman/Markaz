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
import { QuotationService } from "./quotation.service.js";
import { SalesInvoiceService } from "./sales-invoice.service.js";
import { SalesOrderService } from "./sales-order.service.js";

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
    customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C1-${companyId.slice(0, 6)}`, companyId, name: "Customer Co", kind: "COMPANY" } })).id;

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

  it("keeps companies apart", async () => {
    const stranger = { id: "stranger", companyId: newId() };
    await expect(invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat0 }] }, stranger, cid(), newId())).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
    await expect(quotations.get(stranger.companyId, orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
