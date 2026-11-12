import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "./audit-logger.js";
import { AuditQueryService } from "./audit-query.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Audit log reading — real database", () => {
  const prisma = new PrismaClient();
  const logger = new PrismaAuditLogger(prisma);
  const service = new AuditQueryService(prisma, { can: () => Promise.resolve(true) });
  const audit = { list: (companyId: string, query: Parameters<AuditQueryService["list"]>[1]) => service.list(companyId, query, userA), filters: (companyId: string) => service.filters(companyId) };
  const companyA = newId();
  const companyB = newId();
  const userA = newId();
  const userB = newId();
  const legacyUserA = newId();
  // Record ids are unique per run: the table is append-only, so rows from an earlier run of this test are still there.
  const run = newId().slice(-8);

  const logAs = (actorId: string, action: string, entityType: string, entityId: string, extra: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {}) =>
    logger.log({ actorId, action, entityType, entityId, correlationId: newId(), ...extra });

  beforeAll(async () => {
    for (const [id, name] of [[companyA, "A"], [companyB, "B"]] as const) await prisma.company.create({ data: { id, name: `Audit ${name} ${id}`, defaultCurrency: "SAR" } });
    const mk = (id: string, companyId: string, email: string) => prisma.user.create({ data: { id, companyId, ref: `U-${id.slice(-8)}`, email, passwordHash: "x" } });
    await mk(userA, companyA, `a-${userA}@audit.test`);
    await mk(userB, companyB, `b-${userB}@audit.test`);
    await mk(legacyUserA, companyA, `legacy-${legacyUserA}@audit.test`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records the actor's company on new rows, so the log can be read per tenant", async () => {
    await logAs(userA, "account.created", "Account", `acc-1-${run}`, { after: { code: "1010" } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: `acc-1-${run}` } });
    expect(row.companyId).toBe(companyA);
  });

  it("shows a company only its own rows, plus older rows written without a company by one of its users, never anyone else's", async () => {
    await logAs(userB, "account.created", "Account", `acc-b-${run}`);
    // a row from before the company was recorded: no company, written by a user of A
    await prisma.auditLog.create({ data: { id: newId(), actorId: legacyUserA, action: "party.created", entityType: "Party", entityId: `legacy-1-${run}`, correlationId: newId() } });
    // a row nobody can attribute (a system actor)
    await logAs("system-job", "job.ran", "Job", `job-1-${run}`);

    const a = (await audit.list(companyA, { limit: "200" })).data.map((r) => r.entityId);
    expect(a).toEqual(expect.arrayContaining([`acc-1-${run}`, `legacy-1-${run}`]));
    expect(a).not.toContain(`acc-b-${run}`);
    expect(a).not.toContain(`job-1-${run}`);
    const b = (await audit.list(companyB, { limit: "200" })).data.map((r) => r.entityId);
    expect(b).toContain(`acc-b-${run}`);
    expect(b).not.toContain(`acc-1-${run}`);
    expect(b).not.toContain(`legacy-1-${run}`);
    expect((await audit.list(newId(), {})).data).toHaveLength(0);
  });

  it("returns what changed (before and after) and who did it, newest first", async () => {
    await logAs(userA, "employee.updated", "Employee", `emp-1-${run}`, { before: { name: "Old" }, after: { name: "New" } });
    const rows = (await audit.list(companyA, { entityId: `emp-1-${run}` })).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: userA, actorEmail: `a-${userA}@audit.test`, action: "employee.updated", before: { name: "Old" }, after: { name: "New" } });
    const all = (await audit.list(companyA, { limit: "200" })).data;
    const times = all.map((r) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("filters by type, action text, actor and date, and pages", async () => {
    await logAs(userA, "journal_entry.posted", "JournalEntry", `je-1-${run}`);
    await logAs(userA, "journal_entry.posted", "JournalEntry", `je-2-${run}`);
    expect((await audit.list(companyA, { entityType: "JournalEntry" })).data.map((r) => r.entityId).sort()).toEqual([`je-1-${run}`, `je-2-${run}`]);
    expect((await audit.list(companyA, { action: "POSTED", entityType: "JournalEntry" })).data).toHaveLength(2);
    expect((await audit.list(companyA, { actorId: legacyUserA })).data.every((r) => r.actorId === legacyUserA)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect((await audit.list(companyA, { from: today, to: today, entityType: "JournalEntry" })).data).toHaveLength(2);
    expect((await audit.list(companyA, { from: "2000-01-01", to: "2000-01-02" })).data).toHaveLength(0);
    const first = await audit.list(companyA, { entityType: "JournalEntry", limit: "1" });
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await audit.list(companyA, { entityType: "JournalEntry", limit: "1", cursor: first.pageInfo.nextCursor! });
    expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
  });

  it("offers filter choices from this company's own log only", async () => {
    const f = await audit.filters(companyB);
    expect(f.entityTypes).toContain("Account");
    expect(f.entityTypes).not.toContain("JournalEntry");
    expect(f.users.map((u) => u.id)).toEqual([userB]);
  });
  it("resolves invoice and related journal numbers without rewriting historical snapshots", async () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const year = await prisma.fiscalYear.create({ data: { id: newId(), companyId: companyA, name: "Audit fixture", startDate: date, endDate: new Date("2026-12-31T00:00:00Z") } });
    const period = await prisma.fiscalPeriod.create({ data: { id: newId(), companyId: companyA, fiscalYearId: year.id, periodNumber: 1, startDate: date, endDate: year.endDate } });
    const journal = await prisma.journalEntry.create({ data: { id: newId(), companyId: companyA, fiscalPeriodId: period.id, number: "JE-AUDIT-1", entryDate: date, postingDate: date, currency: "SAR", sourceModule: "sales", sourceDocumentType: "sales_invoice", sourceDocumentId: newId(), actorId: userA, correlationId: newId(), idempotencyKey: newId() } });
    const party = await prisma.party.create({ data: { id: newId(), companyId: companyA, ref: "CUSTOMER", name: "Audit fixture customer", kind: "COMPANY" } });
    const common = { companyId: companyA, invoiceDate: date, currency: "SAR", totalNet: "0", totalTax: "0", totalGross: "0", journalEntryId: journal.id, actorId: userA, correlationId: newId() };
    const invoice = await prisma.salesInvoice.create({ data: { ...common, id: newId(), documentType: "INVOICE", number: "INV-AUDIT-1", customerId: party.id } });
    const supplier = await prisma.supplierInvoice.create({ data: { ...common, id: newId(), number: "BILL-AUDIT-1", supplierId: party.id } });
    for (const [entityType, doc] of [["SalesInvoice", invoice], ["SupplierInvoice", supplier]] as const) {
      // Older logs may carry only the id; the current, permission-checked reference fills the number.
      await logAs(userA, "invoice.posted", entityType, doc.id, { after: { journalEntryId: journal.id, totalGross: "0.0000" } });
      const entry = (await audit.list(companyA, { entityId: doc.id })).data[0]!;
      expect(entry.document).toMatchObject({ id: doc.id, number: doc.number });
      expect(entry.relatedDocuments).toEqual([expect.objectContaining({ id: journal.id, number: journal.number })]);
      expect(entry.after).toEqual({ journalEntryId: journal.id, totalGross: "0.0000" });
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).afterJson).toEqual(entry.after);
    }
    const denied = new AuditQueryService(prisma, { can: () => Promise.resolve(false) });
    const restricted = (await denied.list(companyA, { entityId: invoice.id }, userA)).data[0]!;
    expect(restricted.document).toBeNull();
    expect(restricted.relatedDocuments).toEqual([]);
    const invoiceOnly = new AuditQueryService(prisma, { can: (_actor, _action, resource) => Promise.resolve(resource === "sales_invoice") });
    const partial = (await invoiceOnly.list(companyA, { entityId: invoice.id }, userA)).data[0]!;
    expect(partial.document?.number).toBe(invoice.number);
    expect(partial.relatedDocuments).toEqual([]);
  });

  it("never resolves another company's document, including references inside an allowed audit event", async () => {
    const foreign = await prisma.purchaseRequest.create({ data: { id: newId(), companyId: companyB, number: "PRIVATE-REQUEST", status: "PENDING", requestedBy: userB, correlationId: newId() } });
    await logAs(userA, "purchase_request.updated", "PurchaseRequest", foreign.id, { after: { purchaseRequestId: foreign.id, quotationId: newId() } });
    const row = (await audit.list(companyA, { entityId: foreign.id })).data[0]!;
    expect(row.document).toBeNull();
    expect(row.relatedDocuments).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("PRIVATE-REQUEST");
  });

  it("keeps missing and unsupported documents readable without fabricated links", async () => {
    const id = newId();
    await logAs(userA, "quotation.cancelled", "Quotation", id, { after: { number: "QUO-REMOVED", status: "CANCELLED" } });
    const row = (await audit.list(companyA, { entityId: id })).data[0]!;
    expect(row.document).toBeNull();
    expect(row.after).toEqual({ number: "QUO-REMOVED", status: "CANCELLED" });
    expect((await audit.list(companyA, { entityType: "Account" })).data[0]!.document).toBeNull();
  });

});
