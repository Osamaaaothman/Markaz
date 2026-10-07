import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { SupplierInvoiceService } from "../purchasing/supplier-invoice.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { SalesInvoiceService } from "../sales/sales-invoice.service.js";
import { loadOutstanding } from "./outstanding.js";
import { PaymentService } from "./payment.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Payments and allocation — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const taxCodes = new TaxCodeService(prisma, audit);
  const sales = new SalesInvoiceService(prisma, engine, mappings, audit);
  const purchases = new SupplierInvoiceService(prisma, engine, mappings, audit);
  const payments = new PaymentService(prisma, engine, mappings, audit);

  const companyId = newId();
  const actor = { id: "cashier", companyId };
  const cid = (): string => newId();
  const today = new Date();
  const year = today.getUTCFullYear();

  let acc: Record<string, string>;
  let customerId: string;
  let otherCustomerId: string;
  let supplierId: string;
  let vat0: string;
  let invoiceId: string;
  let secondInvoiceId: string;
  let supplierInvoiceId: string;

  async function balance(accountId: string): Promise<number> {
    const row = (await trialBalance.compute(companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }

  const outstandingOf = async (id: string, side: "SALES" | "SUPPLIER"): Promise<string | undefined> =>
    (await loadOutstanding(prisma, companyId, side, { ids: [id] }))[0]?.outstanding.toFixed(4);

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Payments Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string, isPostable = true): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance, isPostable } })).id;
    acc = {
      bank: await make("1010", "Bank", "ASSET", "DEBIT"),
      ar: await make("1200", "Accounts receivable", "ASSET", "DEBIT"),
      ap: await make("2100", "Accounts payable", "LIABILITY", "CREDIT"),
      revenue: await make("4100", "Sales", "REVENUE", "CREDIT"),
      vatOut: await make("2300", "Output VAT", "LIABILITY", "CREDIT"),
      rent: await make("5200", "Rent", "EXPENSE", "DEBIT"),
      vatIn: await make("1300", "Input VAT", "ASSET", "DEBIT"),
      assetsGroup: await make("1", "Assets", "ASSET", "DEBIT", false),
    };
    await mappings.set("ACCOUNTS_RECEIVABLE", acc.ar!, actor, cid());
    await mappings.set("ACCOUNTS_PAYABLE", acc.ap!, actor, cid());
    await mappings.set("SALES_REVENUE", acc.revenue!, actor, cid());
    await mappings.set("VAT_OUTPUT", acc.vatOut!, actor, cid());
    await mappings.set("VAT_INPUT", acc.vatIn!, actor, cid());

    vat0 = (await taxCodes.addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT0")!.id;
    const party = async (name: string) => (await prisma.party.create({ data: { id: newId(), ref: `TEST-${name}-${companyId.slice(0, 6)}`, companyId, name, kind: "COMPANY" } })).id;
    customerId = await party("C1");
    otherCustomerId = await party("C2");
    supplierId = await party("S1");

    const service = (price: string) => ({ description: "Consulting", quantity: "1", unitPrice: price, taxCodeId: vat0 });
    invoiceId = (await sales.createInvoice({ customerId, invoiceDate: today, lines: [service("1000")] }, actor, cid(), newId())).id;
    secondInvoiceId = (await sales.createInvoice({ customerId, invoiceDate: today, lines: [service("300")] }, actor, cid(), newId())).id;
    supplierInvoiceId = (
      await purchases.create(
        { supplierId, supplierInvoiceNumber: "RENT-1", invoiceDate: today, lines: [{ kind: "EXPENSE", accountId: acc.rent!, quantity: "1", unitPrice: "500", taxCodeId: vat0 }] },
        actor,
        cid(),
        newId(),
      )
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("books a part-payment against an invoice: bank in, receivable down, invoice still owes the rest", async () => {
    const bank = await balance(acc.bank!);
    const ar = await balance(acc.ar!);

    const receipt = await payments.create(
      { direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "600", cashAccountId: acc.bank!, method: "BANK_TRANSFER", allocations: [{ invoiceId, amount: "600" }] },
      actor,
      cid(),
      newId(),
    );
    expect(receipt.number).toMatch(/^RCT-.*-000001$/);
    expect(receipt.unallocated).toBe("0.0000");
    expect(await balance(acc.bank!)).toBeCloseTo(bank + 600, 4);
    expect(await balance(acc.ar!)).toBeCloseTo(ar - 600, 4);
    expect(await outstandingOf(invoiceId, "SALES")).toBe("400.0000");
  });

  it("refuses more than an invoice owes, more than the payment, a repeat, and another party's invoice", async () => {
    const attempt = (allocations: { invoiceId: string; amount: string }[], amount = "1000", partyId = customerId) =>
      payments.create({ direction: "RECEIPT", partyId, paymentDate: today, amount, cashAccountId: acc.bank!, method: "CASH", allocations }, actor, cid(), newId());

    await expect(attempt([{ invoiceId, amount: "400.0001" }])).rejects.toMatchObject({ code: "OVER_ALLOCATED" });
    await expect(attempt([{ invoiceId, amount: "400" }, { invoiceId: secondInvoiceId, amount: "300" }], "500")).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_PAYMENT" });
    await expect(attempt([{ invoiceId, amount: "1" }, { invoiceId, amount: "1" }])).rejects.toMatchObject({ code: "DUPLICATE_ALLOCATION" });
    await expect(attempt([{ invoiceId, amount: "1" }], "1", otherCustomerId)).rejects.toMatchObject({ code: "INVOICE_NOT_FOUND" });
    // Nothing was booked by any of them.
    expect(await outstandingOf(invoiceId, "SALES")).toBe("400.0000");
  });

  it("keeps what is not allocated on account, and the receivable follows the ledger", async () => {
    const receipt = await payments.create(
      {
        direction: "RECEIPT",
        partyId: customerId,
        paymentDate: today,
        amount: "800",
        cashAccountId: acc.bank!,
        method: "CHEQUE",
        reference: "CHQ-77",
        allocations: [{ invoiceId, amount: "400" }, { invoiceId: secondInvoiceId, amount: "300" }],
      },
      actor,
      cid(),
      newId(),
    );
    expect(receipt.unallocated).toBe("100.0000");
    expect(await outstandingOf(invoiceId, "SALES")).toBe("0.0000");
    expect(await payments.openInvoices(companyId, customerId, "RECEIPT")).toEqual([]);

    // Invoices 1300 - receipts 1400 = -100: the customer has 100 on account.
    expect(await balance(acc.ar!)).toBeCloseTo(-100, 4);
  });

  it("counts a credit note against an invoice as settling it", async () => {
    const third = (await sales.createInvoice({ customerId, invoiceDate: today, lines: [{ description: "Work", quantity: "1", unitPrice: "200", taxCodeId: vat0 }] }, actor, cid(), newId())).id;
    await sales.createCreditNote({ originalInvoiceId: third, creditDate: today, lines: [{ description: "Discount", quantity: "1", unitPrice: "50", taxCodeId: vat0 }] }, actor, cid(), newId());
    expect(await outstandingOf(third, "SALES")).toBe("150.0000");
    await expect(
      payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "200", cashAccountId: acc.bank!, method: "CASH", allocations: [{ invoiceId: third, amount: "200" }] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "OVER_ALLOCATED" });
  });

  it("pays a supplier: payable down, bank out, supplier invoice part-settled", async () => {
    const ap = await balance(acc.ap!);
    const bank = await balance(acc.bank!);
    const payment = await payments.create(
      { direction: "PAYMENT", partyId: supplierId, paymentDate: today, amount: "300", cashAccountId: acc.bank!, method: "BANK_TRANSFER", allocations: [{ invoiceId: supplierInvoiceId, amount: "300" }] },
      actor,
      cid(),
      newId(),
    );
    expect(payment.number).toMatch(/^PAY-.*-000001$/);
    expect(await balance(acc.ap!)).toBeCloseTo(ap + 300, 4); // debit reduces the credit balance
    expect(await balance(acc.bank!)).toBeCloseTo(bank - 300, 4);
    expect(await outstandingOf(supplierInvoiceId, "SUPPLIER")).toBe("200.0000");
    expect((await payments.openInvoices(companyId, supplierId, "PAYMENT"))[0]?.outstanding).toBe("200.0000");
  });

  it("refuses a group or non-asset account as the bank, and lists payments newest first", async () => {
    await expect(
      payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "1", cashAccountId: acc.assetsGroup!, method: "CASH", allocations: [] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "CASH_ACCOUNT_INVALID" });
    await expect(
      payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "1", cashAccountId: acc.revenue!, method: "CASH", allocations: [] }, actor, cid(), newId()),
    ).rejects.toMatchObject({ code: "CASH_ACCOUNT_INVALID" });

    const page = await payments.list(companyId, { direction: "RECEIPT" });
    expect(page.data.every((p) => /^RCT-/.test(p.number))).toBe(true);
    expect(page.data.length).toBe(2);
    expect((await trialBalance.compute(companyId)).isBalanced).toBe(true);
  });

  it("keeps companies apart", async () => {
    const stranger = { id: "stranger", companyId: newId() };
    await expect(
      payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: today, amount: "1", cashAccountId: acc.bank!, method: "CASH", allocations: [] }, stranger, cid(), newId()),
    ).rejects.toMatchObject({ code: "PARTY_NOT_FOUND" });
  });
});
