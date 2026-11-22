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
import { loadOutstanding } from "../payments/outstanding.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { SalesInvoiceIssueError, SalesInvoiceService } from "./sales-invoice.service.js";
import { SalesOrderService } from "./sales-order.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Voiding an invoice the tax authority rejected — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const stockLevels = new StockLevelService(prisma);
  const orders = new SalesOrderService(prisma, audit);
  // The compliance guard is composition's job; here it allows everything except a marked invoice.
  const refused = new Set<string>();
  const invoices = new SalesInvoiceService(prisma, engine, mappings, audit, undefined, (_tx, input) =>
    refused.has(input.salesInvoiceId) ? Promise.reject(new SalesInvoiceIssueError("COMPLIANCE_VOID_NOT_REJECTED")) : Promise.resolve(),
  );
  const unguarded = new SalesInvoiceService(prisma, engine, mappings, audit);

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

  async function balance(accountId: string): Promise<string> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? (Number(row.debitTotal) - Number(row.creditTotal)).toFixed(4) : "0.0000";
  }
  const onHand = async (): Promise<string | undefined> => (await stockLevels.list(companyId, { itemId }))[0]?.quantity;

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Void Test ${companyId}`, defaultCurrency: "SAR" } });
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
      vat: await make("2300", "Output VAT", "LIABILITY", "CREDIT"),
      cogs: await make("5100", "Cost of goods sold", "EXPENSE", "DEBIT"),
    };
    await mappings.set("INVENTORY", acc.inventory!, actor, cid());
    await mappings.set("GRNI", acc.grni!, actor, cid());
    await mappings.set("ACCOUNTS_RECEIVABLE", acc.ar!, actor, cid());
    await mappings.set("SALES_REVENUE", acc.revenue!, actor, cid());
    await mappings.set("VAT_OUTPUT", acc.vat!, actor, cid());
    await mappings.set("COST_OF_GOODS_SOLD", acc.cogs!, actor, cid());
    vat15 = (await new TaxCodeService(prisma, audit).addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT15")!.id;
    warehouseId = (await new WarehouseService(prisma, audit).create({ code: "WH1", name: "Main" }, actor, cid())).id;
    itemId = (await new ItemService(prisma, audit).create({ code: "CEM", name: "Cement", unit: "BAG" }, actor, cid())).id;
    customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C1-${companyId.slice(0, 6)}`, companyId, name: "Customer Co", kind: "COMPANY" } })).id;
    await new GoodsReceiptService(prisma, engine, mappings, audit).create({ warehouseId, documentDate: today, lines: [{ itemId, quantity: "10", unitCost: "50" }] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const sell = async (): Promise<string> =>
    (await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId, warehouseId, quantity: "4", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid(), newId())).id;

  it("reverses revenue, VAT, receivable and cost, returns the goods, and drops the invoice from receivables", async () => {
    const invoiceId = await sell();
    expect(await onHand()).toBe("6.0000");
    expect(await balance(acc.ar!)).toBe("460.0000");

    await invoices.voidRejectedInvoice({ invoiceId, reason: "ZATCA rejected: buyer VAT number" }, actor, cid());

    expect(await onHand()).toBe("10.0000");
    for (const account of ["ar", "revenue", "vat", "cogs"]) expect(await balance(acc[account]!)).toBe("0.0000");
    expect(await balance(acc.inventory!)).toBe("500.0000");
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
    expect(await loadOutstanding(prisma, companyId, "SALES", { ids: [invoiceId] })).toEqual([]);
    const detail = await invoices.get(companyId, invoiceId);
    expect(detail.voidedAt).not.toBeNull();
    // The invoice row itself is unchanged.
    expect(detail.totalGross).toBe("460.0000");
  });

  it("voids once, refuses notes against a voided invoice, and keeps companies apart", async () => {
    const invoiceId = await sell();
    await invoices.voidRejectedInvoice({ invoiceId, reason: "rejected" }, actor, cid());
    await expect(invoices.voidRejectedInvoice({ invoiceId, reason: "again" }, actor, cid())).rejects.toMatchObject({ code: "ALREADY_VOIDED" });
    await expect(
      invoices.createDebitNote({ originalInvoiceId: invoiceId, debitDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat15 }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "VOIDED_INVOICE" });
    const other = await sell();
    await expect(invoices.voidRejectedInvoice({ invoiceId: other, reason: "x" }, { id: "stranger", companyId: newId() }, cid())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("voids nothing without the compliance guard's consent, or with notes already raised", async () => {
    const invoiceId = await sell();
    await expect(unguarded.voidRejectedInvoice({ invoiceId, reason: "x" }, actor, cid())).rejects.toMatchObject({ code: "VOID_NOT_ALLOWED" });
    refused.add(invoiceId);
    await expect(invoices.voidRejectedInvoice({ invoiceId, reason: "x" }, actor, cid())).rejects.toBeInstanceOf(SalesInvoiceIssueError);
    refused.delete(invoiceId);
    await invoices.createDebitNote({ originalInvoiceId: invoiceId, debitDate: today, lines: [{ description: "x", quantity: "1", unitPrice: "1", taxCodeId: vat15 }] }, actor, cid(), newId());
    await expect(invoices.voidRejectedInvoice({ invoiceId, reason: "x" }, actor, cid())).rejects.toMatchObject({ code: "VOID_NOT_ALLOWED" });
    expect(await prisma.salesInvoiceVoid.count({ where: { salesInvoiceId: invoiceId } })).toBe(0);
  });

  it("releases the quantity the invoice claimed on its order so a corrected invoice can claim it again", async () => {
    const order = await orders.create({ customerId, orderDate: today, lines: [{ itemId, quantity: "2", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid(), newId());
    const line = (await orders.get(companyId, order.id)).lines[0]!;
    const { id: invoiceId } = await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId, warehouseId, salesOrderLineId: line.id, quantity: "2", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid(), newId());
    expect((await orders.get(companyId, order.id)).status).toBe("INVOICED");

    await invoices.voidRejectedInvoice({ invoiceId, reason: "rejected" }, actor, cid());
    const after = await orders.get(companyId, order.id);
    expect(after.status).toBe("OPEN");
    expect(after.lines[0]!.invoicedQuantity).toBe("0.0000");

    await invoices.createInvoice({ customerId, invoiceDate: today, lines: [{ itemId, warehouseId, salesOrderLineId: line.id, quantity: "2", unitPrice: "100", taxCodeId: vat15 }] }, actor, cid(), newId());
    expect((await orders.get(companyId, order.id)).status).toBe("INVOICED");
  });
});
