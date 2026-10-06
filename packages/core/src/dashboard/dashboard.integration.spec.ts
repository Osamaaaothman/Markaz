import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { GoodsReceiptService } from "../inventory/goods-receipt.service.js";
import { ItemService } from "../inventory/item.service.js";
import { WarehouseService } from "../inventory/warehouse.service.js";
import { AgingService } from "../payments/aging.service.js";
import { PaymentService } from "../payments/payment.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { SalesInvoiceService } from "../sales/sales-invoice.service.js";
import { DashboardService, type DashboardSections } from "./dashboard.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const NONE: DashboardSections = { receivables: false, payables: false, profit: false, cash: false, stock: false, sales: false, purchasing: false };
const ALL: DashboardSections = { receivables: true, payables: true, profit: true, cash: true, stock: true, sales: true, purchasing: true };

describeIfDb("Dashboard — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const mappings = new AccountMappingService(prisma, audit);
  const dashboard = new DashboardService(prisma, new AgingService(prisma, mappings));

  const companyId = newId();
  const actor = { id: "owner", companyId };
  const cid = (): string => newId();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = today.getUTCFullYear();
  // The "old" invoice is dated Jan 2; in January it falls in the current month too.
  const monthRevenue = today.getUTCMonth() === 0 ? "1500.0000" : "500.0000";

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Dashboard Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance } })).id;
    const acc = {
      bank: await make("1010", "Bank", "ASSET", "DEBIT"),
      ar: await make("1200", "AR", "ASSET", "DEBIT"),
      revenue: await make("4100", "Sales", "REVENUE", "CREDIT"),
      vat: await make("2300", "VAT", "LIABILITY", "CREDIT"),
      inventory: await make("1040", "Inventory", "ASSET", "DEBIT"),
      grni: await make("2010", "GRNI", "LIABILITY", "CREDIT"),
      cogs: await make("5100", "COGS", "EXPENSE", "DEBIT"),
    };
    await mappings.set("ACCOUNTS_RECEIVABLE", acc.ar, actor, cid());
    await mappings.set("SALES_REVENUE", acc.revenue, actor, cid());
    await mappings.set("VAT_OUTPUT", acc.vat, actor, cid());
    await mappings.set("INVENTORY", acc.inventory, actor, cid());
    await mappings.set("GRNI", acc.grni, actor, cid());
    await mappings.set("COST_OF_GOODS_SOLD", acc.cogs, actor, cid());
    const vat0 = (await new TaxCodeService(prisma, audit).addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT0")!.id;

    const customerId = (await prisma.party.create({ data: { id: newId(), ref: `TEST-C-${companyId.slice(0, 6)}`, companyId, name: "Customer", kind: "COMPANY" } })).id;
    const warehouseId = (await new WarehouseService(prisma, audit).create({ code: "W", name: "Main" }, actor, cid())).id;
    const itemId = (await new ItemService(prisma, audit).create({ code: "I", name: "Item", unit: "EA", reorderPoint: "5" }, actor, cid())).id;
    await new GoodsReceiptService(prisma, engine, mappings, audit).create({ warehouseId, documentDate: today, lines: [{ itemId, quantity: "3", unitCost: "10" }] }, actor, cid(), newId());

    const sales = new SalesInvoiceService(prisma, engine, mappings, audit);
    // 1000 due long ago (overdue), 500 not yet due.
    await sales.createInvoice({ customerId, invoiceDate: new Date(Date.UTC(year, 0, 2)), dueDate: new Date(Date.UTC(year, 0, 3)), lines: [{ description: "Old", quantity: "1", unitPrice: "1000", taxCodeId: vat0 }] }, actor, cid(), newId());
    await sales.createInvoice({ customerId, invoiceDate: today, dueDate: new Date(today.getTime() + 20 * 86_400_000), lines: [{ description: "New", quantity: "1", unitPrice: "500", taxCodeId: vat0 }] }, actor, cid(), newId());
    await new PaymentService(prisma, engine, mappings, audit).create({ direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "200", cashAccountId: acc.bank, method: "CASH", allocations: [] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns only the sections it was allowed to", async () => {
    const data = await dashboard.compute(companyId, NONE, today);
    expect(data.currency).toBe("SAR");
    expect(Object.keys(data).sort()).toEqual(["asOf", "currency"]);
  });

  it("shows receivables with the overdue part, matching the ageing", async () => {
    const data = await dashboard.compute(companyId, ALL, today);
    // 1000 + 500 invoiced, 200 on account: 1300 owed, of which 1000 is overdue.
    expect(data.receivables).toEqual({ total: "1300.0000", overdue: "1000.0000" });
    expect(data.payables).toEqual({ total: "0.0000", overdue: "0.0000" });
  });

  it("shows six months with the sales in the current one, cash from the used bank, and stock", async () => {
    const data = await dashboard.compute(companyId, ALL, today);
    expect(data.monthly).toHaveLength(6);
    expect(data.monthly![5]!.month).toBe(today.toISOString().slice(0, 7));
    expect(data.monthly![5]!.revenue).toBe(monthRevenue);
    expect(data.cash).toEqual({ balance: "200.0000" });
    expect(data.stock).toEqual({ value: "30.0000", belowReorder: 1 }); // 3 on hand, reorder at 5
    expect(data.sales).toMatchObject({ thisMonthNet: monthRevenue, openQuotations: 0, openOrders: 0 });
    expect(data.purchasing).toEqual({ pendingApprovals: 0, openOrders: 0, pendingRequests: 0 });
  });

  it("shows nothing of another company", async () => {
    const data = await dashboard.compute(newId(), { ...ALL }, today).catch((e: Error) => e);
    // An unknown company has no currency row, so it is refused rather than shown empty.
    expect(data).toBeInstanceOf(Error);
  });
});
