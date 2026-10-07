import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { SupplierInvoiceService } from "../purchasing/supplier-invoice.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";
import { SalesInvoiceService } from "../sales/sales-invoice.service.js";
import { AgingService } from "./aging.service.js";
import { PartyNotFoundError, PartyStatementService } from "./party-statement.service.js";
import { PaymentService } from "./payment.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Ageing and party statements — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const mappings = new AccountMappingService(prisma, audit);
  const taxCodes = new TaxCodeService(prisma, audit);
  const sales = new SalesInvoiceService(prisma, engine, mappings, audit);
  const purchases = new SupplierInvoiceService(prisma, engine, mappings, audit);
  const payments = new PaymentService(prisma, engine, mappings, audit);
  const aging = new AgingService(prisma, mappings);
  const statements = new PartyStatementService(prisma);

  const companyId = newId();
  const actor = { id: "accountant", companyId };
  const cid = (): string => newId();
  const year = new Date().getUTCFullYear();
  const on = (month: number, d: number): Date => new Date(Date.UTC(year, month - 1, d));

  let acc: Record<string, string>;
  let customerId: string;
  let supplierId: string;
  let vat0: string;

  const service = (price: string) => ({ description: "Consulting", quantity: "1", unitPrice: price, taxCodeId: vat0 });

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: `Ageing Test ${companyId}`, defaultCurrency: "SAR" } });
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: on(1, 1), endDate: on(12, 31) },
    });
    await prisma.fiscalPeriod.create({
      data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: on(1, 1), endDate: on(12, 31) },
    });
    const make = async (code: string, name: string, type: string, normalBalance: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `TEST-${code}-${companyId.slice(0, 6)}`, companyId, code, name, type, normalBalance } })).id;
    acc = {
      bank: await make("1010", "Bank", "ASSET", "DEBIT"),
      ar: await make("1200", "Accounts receivable", "ASSET", "DEBIT"),
      ap: await make("2100", "Accounts payable", "LIABILITY", "CREDIT"),
      revenue: await make("4100", "Sales", "REVENUE", "CREDIT"),
      vatOut: await make("2300", "Output VAT", "LIABILITY", "CREDIT"),
      vatIn: await make("1300", "Input VAT", "ASSET", "DEBIT"),
      rent: await make("5200", "Rent", "EXPENSE", "DEBIT"),
    };
    await mappings.set("ACCOUNTS_RECEIVABLE", acc.ar!, actor, cid());
    await mappings.set("ACCOUNTS_PAYABLE", acc.ap!, actor, cid());
    await mappings.set("SALES_REVENUE", acc.revenue!, actor, cid());
    await mappings.set("VAT_OUTPUT", acc.vatOut!, actor, cid());
    await mappings.set("VAT_INPUT", acc.vatIn!, actor, cid());
    vat0 = (await taxCodes.addSaudiDefaults(actor, cid())).find((c) => c.code === "VAT0")!.id;
    const party = async (name: string) => (await prisma.party.create({ data: { id: newId(), ref: `TEST-${name}-${companyId.slice(0, 6)}`, companyId, name, kind: "COMPANY" } })).id;
    customerId = await party("Customer");
    supplierId = await party("Supplier");

    // Customer: A 1000 (Jan 10, due Feb 9), B 500 (Mar 20, due Apr 19), C 200 (Dec 10, after the report date).
    const a = await sales.createInvoice({ customerId, invoiceDate: on(1, 10), dueDate: on(2, 9), lines: [service("1000")] }, actor, cid(), newId());
    const b = await sales.createInvoice({ customerId, invoiceDate: on(3, 20), dueDate: on(4, 19), lines: [service("500")] }, actor, cid(), newId());
    await sales.createInvoice({ customerId, invoiceDate: on(12, 10), dueDate: on(12, 31), lines: [service("200")] }, actor, cid(), newId());
    await payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: on(3, 1), amount: "300", cashAccountId: acc.bank!, method: "CASH", allocations: [{ invoiceId: a.id, amount: "300" }] }, actor, cid(), newId());
    await payments.create({ direction: "RECEIPT", partyId: customerId, paymentDate: on(3, 15), amount: "100", cashAccountId: acc.bank!, method: "CASH", allocations: [] }, actor, cid(), newId());
    await sales.createCreditNote({ originalInvoiceId: b.id, creditDate: on(3, 25), lines: [{ description: "Discount", quantity: "1", unitPrice: "50", taxCodeId: vat0 }] }, actor, cid(), newId());

    // Supplier: 400 (Feb 1, due Mar 3), 150 paid on Mar 10.
    const s = await purchases.create(
      { supplierId, supplierInvoiceNumber: "R-1", invoiceDate: on(2, 1), dueDate: on(3, 3), lines: [{ kind: "EXPENSE", accountId: acc.rent!, quantity: "1", unitPrice: "400", taxCodeId: vat0 }] },
      actor,
      cid(),
      newId(),
    );
    await payments.create({ direction: "PAYMENT", partyId: supplierId, paymentDate: on(3, 10), amount: "150", cashAccountId: acc.bank!, method: "BANK_TRANSFER", allocations: [{ invoiceId: s.id, amount: "150" }] }, actor, cid(), newId());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ages receivables as of a date and ties to the ledger", async () => {
    const report = await aging.report(companyId, "SALES", on(3, 31));
    const row = report.parties[0]!;
    expect(report.parties).toHaveLength(1);
    expect(row).toMatchObject({ days31to60: "700.0000", current: "450.0000", onAccount: "-100.0000", total: "1050.0000" });
    expect(row.days1to30).toBe("0.0000");
    expect(report.totals.total).toBe("1050.0000");
    // Invoices 1500 - receipts 400 - credit 50 = 1050 in the ledger on the same date.
    expect(report.ledgerBalance).toBe("1050.0000");
    expect(report.difference).toBe("0.0000");
  });

  it("rolls the position back: earlier dates see fewer documents and still tie", async () => {
    const early = await aging.report(companyId, "SALES", on(2, 28));
    // Only A (1000, due Feb 9 -> 19 days overdue); the receipts and B come later.
    expect(early.totals).toMatchObject({ days1to30: "1000.0000", current: "0.0000", total: "1000.0000" });
    expect(early.difference).toBe("0.0000");

    const late = await aging.report(companyId, "SALES", on(12, 31));
    expect(late.totals.total).toBe("1250.0000"); // 1700 invoices - 400 receipts - 50 credit
    expect(late.difference).toBe("0.0000");
  });

  it("ages payables and ties to the ledger", async () => {
    const report = await aging.report(companyId, "SUPPLIER", on(3, 31));
    expect(report.parties[0]).toMatchObject({ days1to30: "250.0000", total: "250.0000" }); // 28 days overdue
    expect(report.ledgerBalance).toBe("250.0000");
    expect(report.difference).toBe("0.0000");
  });

  it("reports no ledger tie when the control account is not mapped, rather than guessing", async () => {
    const empty = await aging.report(newId(), "SALES", on(3, 31));
    expect(empty.parties).toEqual([]);
    expect(empty.ledgerBalance).toBeNull();
    expect(empty.difference).toBeNull();
  });

  it("builds a customer statement with the opening balance and a running balance", async () => {
    const statement = await statements.statement(companyId, customerId, "SALES", on(3, 1), on(3, 31));
    expect(statement.openingBalance).toBe("1000.0000"); // invoice A, before March
    expect(statement.lines.map((l) => [l.kind, l.balance])).toEqual([
      ["RECEIPT", "700.0000"],
      ["RECEIPT", "600.0000"],
      ["INVOICE", "1100.0000"],
      ["CREDIT_NOTE", "1050.0000"],
    ]);
    expect(statement.totalCharges).toBe("500.0000");
    expect(statement.totalSettlements).toBe("450.0000");
    expect(statement.closingBalance).toBe("1050.0000");
  });

  it("builds a supplier statement", async () => {
    const statement = await statements.statement(companyId, supplierId, "SUPPLIER", on(1, 1), on(3, 31));
    expect(statement.lines.map((l) => [l.kind, l.reference, l.balance])).toEqual([
      ["INVOICE", "R-1", "400.0000"],
      ["PAYMENT", null, "250.0000"],
    ]);
    expect(statement.closingBalance).toBe("250.0000");
  });

  it("does not show another company's party", async () => {
    await expect(statements.statement(newId(), customerId, "SALES", on(1, 1), on(12, 31))).rejects.toBeInstanceOf(PartyNotFoundError);
  });
});
