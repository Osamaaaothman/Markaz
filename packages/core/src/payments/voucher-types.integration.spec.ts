import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { PaymentService, type CreatePaymentInput, type PaymentCounterpartyKind, type PaymentDirection } from "./payment.service.js";
import { PartyStatementService } from "./party-statement.service.js";
import { AgingService } from "./aging.service.js";
import { SalesInvoiceService } from "../sales/sales-invoice.service.js";
import { TaxCodeService } from "../purchasing/tax-code.service.js";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Receipt/payment counterparty and cash-account rules — PostgreSQL", () => {
  const prisma = new PrismaClient();
  const companyId = newId();
  const actor = { id: "voucher-tests", companyId };
  const audit = new PrismaAuditLogger(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const service = new PaymentService(prisma, engine, mappings, audit);
  const date = new Date("2026-06-15T00:00:00Z");
  const accounts: Record<string, string> = {};
  const parties: Record<string, string> = {};
  let taxCodeId: string;

  async function account(code: string, type = "ASSET", parentId?: string, partyId?: string, isPostable = true) {
    const row = await prisma.account.create({ data: { id: newId(), ref: code, companyId, code, name: code, type, normalBalance: type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT", isPostable, ...(parentId ? { parentId } : {}), ...(partyId ? { partyId } : {}) } });
    return row.id;
  }
  async function party(kind: string) {
    return (await prisma.party.create({ data: { id: newId(), ref: newId(), companyId, name: kind, kind } })).id;
  }
  function input(kind: PaymentCounterpartyKind = "CUSTOMER", direction: PaymentDirection = "RECEIPT"): CreatePaymentInput {
    return { direction, counterpartyKind: kind, ...(kind !== "ACCOUNT" ? { partyId: parties[kind]! } : {}), ...(kind === "ACCOUNT" ? { counterAccountId: accounts.expense! } : kind === "EMPLOYEE" ? { counterAccountId: accounts.employee! } : {}), paymentDate: date, amount: "25.1250", cashAccountId: accounts.bank!, method: "BANK_TRANSFER", allocations: [] };
  }
  const create = (value: CreatePaymentInput) => service.create(value, actor, newId(), newId());

  beforeAll(async () => {
    await prisma.company.create({ data: { id: companyId, name: "Voucher tests", defaultCurrency: "SAR" } });
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: year.id, periodNumber: 1, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    for (const kind of ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "CUSTOMER_SUPPLIER"]) parties[kind] = await party(kind);
    accounts.bankFolder = await account("BANKS", "ASSET", undefined, undefined, false);
    accounts.bankSubfolder = await account("ARBITRARY", "ASSET", accounts.bankFolder, undefined, false);
    accounts.bank = await account("NO-CODE-PREFIX", "ASSET", accounts.bankSubfolder);
    accounts.cashFolder = await account("CASH", "ASSET", undefined, undefined, false);
    accounts.cash = await account("TILL", "ASSET", accounts.cashFolder);
    accounts.inactive = await account("STOPPED", "ASSET", accounts.bankFolder);
    await prisma.account.update({ where: { id: accounts.inactive }, data: { isActive: false } });
    accounts.ar = await account("AR");
    accounts.ap = await account("AP", "LIABILITY");
    accounts.employee = await account("EMPLOYEE-ACCOUNT", "LIABILITY", undefined, parties.EMPLOYEE);
    accounts.expense = await account("EXPENSE", "EXPENSE");
    accounts.revenue = await account("REVENUE", "REVENUE");
    accounts.vat = await account("VAT", "LIABILITY");
    await mappings.set("BANK_ACCOUNTS_PARENT", accounts.bankFolder, actor, newId());
    await mappings.set("CASH_ACCOUNTS_PARENT", accounts.cashFolder, actor, newId());
    await mappings.set("ACCOUNTS_RECEIVABLE", accounts.ar, actor, newId());
    await mappings.set("ACCOUNTS_PAYABLE", accounts.ap, actor, newId());
    await mappings.set("SALES_REVENUE", accounts.revenue, actor, newId());
    await mappings.set("VAT_OUTPUT", accounts.vat, actor, newId());
    taxCodeId = (await new TaxCodeService(prisma, audit).addSaudiDefaults(actor, newId())).find((tax) => tax.code === "VAT0")!.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it.each(["BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const)("offers only active nested bank accounts for %s and rejects cash", async (method) => {
    expect((await service.cashAccounts(companyId, method)).map((a) => a.id)).toEqual([accounts.bank]);
    await expect(create({ ...input(), method, cashAccountId: accounts.cash! })).rejects.toMatchObject({ code: "CASH_ACCOUNT_INVALID" });
    await expect(create({ ...input(), method })).resolves.toHaveProperty("id");
  });

  it("offers only cash accounts for cash and rejects unrelated assets, folders, inactive banks and wrong method", async () => {
    expect((await service.cashAccounts(companyId, "CASH")).map((a) => a.id)).toEqual([accounts.cash]);
    for (const cashAccountId of [accounts.bank!, accounts.ar!, accounts.cashFolder!, accounts.inactive!]) {
      await expect(create({ ...input(), method: "CASH", cashAccountId })).rejects.toMatchObject({ code: "CASH_ACCOUNT_INVALID" });
    }
    await expect(create({ ...input(), method: "CASH", cashAccountId: accounts.cash! })).resolves.toHaveProperty("id");
    expect(await service.cashAccounts(newId(), "CASH")).toEqual([]);
  });

  it.each(["RECEIPT", "PAYMENT"] as const)("posts all four counterparty kinds on the chosen side for %s", async (direction) => {
    for (const kind of ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "ACCOUNT"] as const) {
      const saved = await create(input(kind, direction));
      const control = kind === "CUSTOMER" ? accounts.ar : kind === "SUPPLIER" ? accounts.ap : kind === "EMPLOYEE" ? accounts.employee : accounts.expense;
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: saved.journalEntryId } });
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => ({ id: line.accountId, debit: line.debit.toFixed(4), credit: line.credit.toFixed(4) }))).toEqual(expect.arrayContaining([
        { id: accounts.bank, debit: direction === "RECEIPT" ? "25.1250" : "0.0000", credit: direction === "PAYMENT" ? "25.1250" : "0.0000" },
        { id: control, debit: direction === "PAYMENT" ? "25.1250" : "0.0000", credit: direction === "RECEIPT" ? "25.1250" : "0.0000" },
      ]));
      expect(await service.get(saved.id, companyId)).toMatchObject({ counterpartyKind: kind, counterAccountId: control, partyId: kind === "ACCOUNT" ? null : parties[kind] });
    }
  });

  it("enforces party kinds, employee ownership, distinct active accounts and tenant isolation", async () => {
    await expect(create({ ...input(), partyId: parties.SUPPLIER! })).rejects.toMatchObject({ code: "PARTY_KIND_INVALID" });
    await expect(create({ ...input(), counterpartyKind: undefined, partyId: parties.EMPLOYEE! })).rejects.toMatchObject({ code: "PARTY_KIND_INVALID" });
    await expect(create({ ...input("EMPLOYEE"), counterAccountId: accounts.ar! })).rejects.toMatchObject({ code: "COUNTER_ACCOUNT_INVALID" });
    await expect(create({ ...input("ACCOUNT"), counterAccountId: accounts.bank! })).rejects.toMatchObject({ code: "COUNTER_ACCOUNT_INVALID" });
    await expect(create({ ...input("ACCOUNT"), counterAccountId: accounts.inactive! })).rejects.toMatchObject({ code: "COUNTER_ACCOUNT_INVALID" });
    await expect(create({ ...input("ACCOUNT"), partyId: parties.CUSTOMER! })).rejects.toMatchObject({ code: "PARTY_KIND_INVALID" });
    await expect(service.create(input(), { ...actor, companyId: newId() }, newId(), newId())).rejects.toMatchObject({ code: "PARTY_NOT_FOUND" });
    await expect(service.create(input("ACCOUNT"), { ...actor, companyId: newId() }, newId(), newId())).rejects.toMatchObject({ code: "CASH_ACCOUNT_NOT_FOUND" });
    for (const kind of ["CUSTOMER", "SUPPLIER"] as const) await expect(create({ ...input(kind), partyId: parties.CUSTOMER_SUPPLIER! })).resolves.toHaveProperty("id");
  });

  it("rejects invoice allocations for employee, account, customer payment and supplier receipt", async () => {
    for (const value of [input("EMPLOYEE"), input("ACCOUNT"), input("CUSTOMER", "PAYMENT"), input("SUPPLIER", "RECEIPT")]) {
      await expect(create({ ...value, allocations: [{ invoiceId: newId(), amount: "1" }] })).rejects.toMatchObject({ code: "ALLOCATION_NOT_ALLOWED" });
    }
  });

  it("keeps refunds out of settlement funds and reconciles customer statements with the ledger", async () => {
    const partyId = await party("CUSTOMER");
    await create({ ...input(), partyId, amount: "100" });
    await create({ ...input("CUSTOMER", "PAYMENT"), partyId, amount: "30" });
    expect((await service.partyBalance(companyId, partyId, "RECEIPT")).totalUnallocated).toBe("70.0000");
    const statement = await new PartyStatementService(prisma).statement(companyId, partyId, "SALES", new Date("2026-01-01"), new Date("2026-12-31"));
    expect(statement).toMatchObject({ totalCharges: "30.0000", totalSettlements: "100.0000", closingBalance: "-70.0000" });
    const invoice = await new SalesInvoiceService(prisma, engine, mappings, audit).createInvoice({ customerId: partyId, invoiceDate: date, lines: [{ description: "Service", quantity: "1", unitPrice: "100", taxCodeId }] }, actor, newId(), newId());
    await expect(service.settle({ partyId, direction: "RECEIPT", allocations: [{ invoiceId: invoice.id, amount: "80" }] }, actor, newId())).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await service.settle({ partyId, direction: "RECEIPT", allocations: [{ invoiceId: invoice.id, amount: "70" }] }, actor, newId());
    expect((await service.partyBalance(companyId, partyId, "RECEIPT")).totalUnallocated).toBe("0.0000");
    expect((await new AgingService(prisma, mappings).report(companyId, "SALES", new Date("2026-12-31"))).difference).toBe("0.0000");
  });

  it("reverses the actual stored accounts and keeps original invoice allocations as history", async () => {
    const partyId = await party("CUSTOMER");
    const invoice = await new SalesInvoiceService(prisma, engine, mappings, audit).createInvoice({ customerId: partyId, invoiceDate: date, lines: [{ description: "Service", quantity: "1", unitPrice: "50", taxCodeId }] }, actor, newId(), newId());
    const saved = await create({ ...input(), partyId, amount: "50", allocations: [{ invoiceId: invoice.id, amount: "50" }] });
    const reversed = await service.reverse({ paymentId: saved.id, reversalDate: new Date("2026-06-16") }, actor, newId(), newId());
    expect(await prisma.paymentAllocation.count({ where: { paymentId: saved.id } })).toBe(1);
    expect((await service.openInvoices(companyId, partyId, "RECEIPT"))[0]?.outstanding).toBe("50.0000");
    expect((await service.partyBalance(companyId, partyId, "RECEIPT")).totalUnallocated).toBe("0.0000");
    await expect(service.reverse({ paymentId: reversed.id, reversalDate: date }, actor, newId(), newId())).rejects.toMatchObject({ code: "ALREADY_VOIDED" });
    for (const kind of ["EMPLOYEE", "ACCOUNT"] as const) {
      const voucher = await create(input(kind, "PAYMENT"));
      const reversal = await service.reverse({ paymentId: voucher.id, reversalDate: date }, actor, newId(), newId());
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: { in: [voucher.journalEntryId, reversal.journalEntryId] } } });
      for (const accountId of new Set(lines.map((line) => line.accountId))) {
        const total = lines.filter((line) => line.accountId === accountId).reduce((sum, line) => sum + BigInt(line.debit.mul(10000).toFixed(0)) - BigInt(line.credit.mul(10000).toFixed(0)), 0n);
        expect(total).toBe(0n);
      }
    }
    expect((await new AgingService(prisma, mappings).report(companyId, "SALES", new Date("2026-12-31"))).difference).toBe("0.0000");
  });
});
