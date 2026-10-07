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
import { WarehouseService } from "../inventory/warehouse.service.js";
import { PurchaseOrderService } from "./purchase-order.service.js";
import { PurchaseReceiptService } from "./purchase-receipt.service.js";
import { SupplierInvoiceService } from "./supplier-invoice.service.js";
import { TaxCodeService } from "./tax-code.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Supplier invoices (M5, three-way match) — real database", () => {
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
  const taxCodes = new TaxCodeService(prisma, audit);
  const invoices = new SupplierInvoiceService(prisma, engine, mappings, audit);

  const companyId = newId();
  const actor = { id: "accountant", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let acc: Record<string, string>;
  let warehouseId: string;
  let itemId: string;
  let supplierId: string;
  let otherSupplierId: string;
  let vat15: string;
  let vat0: string;
  let poId: string;
  let poLineId: string;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  const poInvoiceLine = (quantity: string, unitPrice: string, taxCodeId = vat15) => ({
    kind: "PO_LINE" as const,
    purchaseOrderLineId: poLineId,
    quantity,
    unitPrice,
    taxCodeId,
  });

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Invoice Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });

    const make = async (code: string, name: string, type: string, normalBalance: string, isPostable = true): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance, isPostable } })).id;
    acc = {
      inventory: await make("1040", "Inventory", "ASSET", "DEBIT"),
      grni: await make("2010", "GRNI", "LIABILITY", "CREDIT"),
      ap: await make("2100", "Accounts payable", "LIABILITY", "CREDIT"),
      vat: await make("1300", "Input VAT", "ASSET", "DEBIT"),
      ppv: await make("5900", "Price variance", "EXPENSE", "DEBIT"),
      rent: await make("5200", "Rent", "EXPENSE", "DEBIT"),
      group: await make("5", "Expenses", "EXPENSE", "DEBIT", false),
    };
    await mappings.set("INVENTORY", acc.inventory!, actor, cid());
    await mappings.set("GRNI", acc.grni!, actor, cid());
    await mappings.set("ACCOUNTS_PAYABLE", acc.ap!, actor, cid());
    await mappings.set("VAT_INPUT", acc.vat!, actor, cid());
    // PURCHASE_PRICE_VARIANCE is deliberately left unmapped until the variance test.

    const codes = await taxCodes.addSaudiDefaults(actor, cid());
    vat15 = codes.find((c) => c.code === "VAT15")!.id;
    vat0 = codes.find((c) => c.code === "VAT0")!.id;

    warehouseId = (await warehouses.create({ code: "WH1", name: "Main" }, actor, cid())).id;
    itemId = (await items.create({ code: "CEM", name: "Cement", unit: "BAG" }, actor, cid())).id;
    const party = (name: string) => prisma.party.create({ data: { id: newId(), ref: `TEST-${name}-${companyId.slice(0, 6)}`, companyId, name, kind: "COMPANY" } });
    supplierId = (await party("S1")).id;
    otherSupplierId = (await party("S2")).id;

    const order = await orders.create({ supplierId, orderDate: today, lines: [{ itemId, quantity: "10", unitPrice: "40" }] }, actor, cid());
    poId = order.id;
    poLineId = (await orders.get(companyId, poId)).lines[0]!.id;
    await receiving.receive(poId, { warehouseId, documentDate: today, lines: [{ purchaseOrderLineId: poLineId, quantity: "6" }] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("adds the Saudi tax codes once, and keeps zero-rated at 0", async () => {
    const again = await taxCodes.addSaudiDefaults(actor, cid());
    expect(again.map((c) => c.code).sort()).toEqual(["EXEMPT", "OUT_OF_SCOPE", "VAT0", "VAT15"]);
    expect(again.find((c) => c.code === "VAT15")?.rate).toBe("15.0000");
    await expect(taxCodes.create({ code: "BAD", name: "Bad", rate: "5", treatment: "EXEMPT" }, actor, cid())).rejects.toMatchObject({ code: "INVALID_RATE" });
  });

  it("posts a matched invoice: GRNI cleared at the order price, input VAT, payable for the gross", async () => {
    const grni = await balance(acc.grni!);
    const ap = await balance(acc.ap!);
    const vat = await balance(acc.vat!);

    const result = await invoices.create(
      { supplierId, supplierInvoiceNumber: "INV-100", invoiceDate: today, lines: [poInvoiceLine("4", "40")] },
      actor,
      cid(),
      newId(),
    );
    expect(result.number).toMatch(/^SI-.*-000001$/);
    expect(result.totalGross).toBe("184.0000");

    expect(await balance(acc.grni!)).toBeCloseTo(grni + 160, 4); // debit reduces the credit balance
    expect(await balance(acc.vat!)).toBeCloseTo(vat + 24, 4);
    expect(await balance(acc.ap!)).toBeCloseTo(ap - 184, 4);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("refuses more than was received and not yet invoiced, and shows the headroom in the preview", async () => {
    const preview = await invoices.preview({ supplierId, supplierInvoiceNumber: "INV-101", invoiceDate: today, lines: [poInvoiceLine("3", "40")] }, actor);
    expect(preview.canPost).toBe(false);
    expect(preview.lines[0]).toMatchObject({ issue: "QTY_EXCEEDS_RECEIVED", invoiceableQuantity: "2.0000" });

    await expect(
      invoices.create({ supplierId, supplierInvoiceNumber: "INV-101", invoiceDate: today, lines: [poInvoiceLine("3", "40")] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "QTY_EXCEEDS_RECEIVED", lineNumber: 1 });
  });

  it("surfaces a price difference, needs it accepted, needs the variance account, then books it", async () => {
    const lines = [poInvoiceLine("2", "42")];
    const preview = await invoices.preview({ supplierId, supplierInvoiceNumber: "INV-102", invoiceDate: today, lines }, actor);
    expect(preview.hasPriceVariance).toBe(true);
    expect(preview.totalPriceVariance).toBe("4.0000");

    await expect(invoices.create({ supplierId, supplierInvoiceNumber: "INV-102", invoiceDate: today, lines }, actor, cid(), newId())).rejects.toMatchObject({
      code: "PRICE_VARIANCE_NOT_ACCEPTED",
    });
    await expect(
      invoices.create({ supplierId, supplierInvoiceNumber: "INV-102", invoiceDate: today, acceptPriceVariance: true, lines }, actor, cid(), newId()),
    ).rejects.toBeInstanceOf(UnmappedAccountError);
    // The failed attempt left nothing behind: the order line is still invoiceable.
    expect((await invoices.listInvoiceable(companyId, supplierId))[0]?.invoiceableQuantity).toBe("2.0000");

    await mappings.set("PURCHASE_PRICE_VARIANCE", acc.ppv!, actor, cid());
    const ppv = await balance(acc.ppv!);
    const result = await invoices.create(
      { supplierId, supplierInvoiceNumber: "INV-102", invoiceDate: today, acceptPriceVariance: true, lines },
      actor,
      cid(),
      newId(),
    );
    expect(result.totalGross).toBe("96.6000"); // net 84 + VAT 12.6
    expect(await balance(acc.ppv!)).toBeCloseTo(ppv + 4, 4);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
    expect(await invoices.listInvoiceable(companyId, supplierId)).toEqual([]);
  });

  it("posts a non-order expense invoice straight to its account, and refuses a group account", async () => {
    const rent = await balance(acc.rent!);
    const ap = await balance(acc.ap!);
    const result = await invoices.create(
      { supplierId, supplierInvoiceNumber: "RENT-1", invoiceDate: today, lines: [{ kind: "EXPENSE", accountId: acc.rent!, description: "October rent", quantity: "1", unitPrice: "1000", taxCodeId: vat0 }] },
      actor,
      cid(),
      newId(),
    );
    expect(result.totalGross).toBe("1000.0000");
    expect(await balance(acc.rent!)).toBeCloseTo(rent + 1000, 4);
    expect(await balance(acc.ap!)).toBeCloseTo(ap - 1000, 4);

    await expect(
      invoices.create(
        { supplierId, supplierInvoiceNumber: "RENT-2", invoiceDate: today, lines: [{ kind: "EXPENSE", accountId: acc.group!, quantity: "1", unitPrice: "5", taxCodeId: vat0 }] },
        actor,
        cid(),
        newId(),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_POSTABLE" });
  });

  it("refuses the same supplier invoice number twice, and another supplier's order line", async () => {
    await expect(
      invoices.create(
        { supplierId, supplierInvoiceNumber: "RENT-1", invoiceDate: today, lines: [{ kind: "EXPENSE", accountId: acc.rent!, quantity: "1", unitPrice: "1", taxCodeId: vat0 }] },
        actor,
        cid(),
        newId(),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_INVOICE" });

    await expect(
      invoices.create({ supplierId: otherSupplierId, supplierInvoiceNumber: "X-1", invoiceDate: today, lines: [poInvoiceLine("1", "40")] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "SUPPLIER_MISMATCH" });
  });

  it("keeps the payable equal to the sum of the invoices", async () => {
    const page = await invoices.list(companyId, {});
    const total = page.data.reduce((sum, i) => sum + Number(i.totalGross), 0);
    expect(total).toBeCloseTo(184 + 96.6 + 1000, 4);
    expect(await balance(acc.ap!)).toBeCloseTo(-total, 4);
  });
});
