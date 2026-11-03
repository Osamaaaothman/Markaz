import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "./audit-logger.js";
import { AuditQueryService } from "./audit-query.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Audit log reading — real database", () => {
  const prisma = new PrismaClient();
  const logger = new PrismaAuditLogger(prisma);
  const audit = new AuditQueryService(prisma);
  const companyA = newId();
  const companyB = newId();
  const userA = newId();
  const userB = newId();
  const legacyUserA = newId();

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
    await logAs(userA, "account.created", "Account", "acc-1", { after: { code: "1010" } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: "acc-1" } });
    expect(row.companyId).toBe(companyA);
  });

  it("shows a company only its own rows, plus older rows written without a company by one of its users, never anyone else's", async () => {
    await logAs(userB, "account.created", "Account", "acc-b");
    // a row from before the company was recorded: no company, written by a user of A
    await prisma.auditLog.create({ data: { id: newId(), actorId: legacyUserA, action: "party.created", entityType: "Party", entityId: "legacy-1", correlationId: newId() } });
    // a row nobody can attribute (a system actor)
    await logAs("system-job", "job.ran", "Job", "job-1");

    const a = (await audit.list(companyA, { limit: "200" })).data.map((r) => r.entityId);
    expect(a).toEqual(expect.arrayContaining(["acc-1", "legacy-1"]));
    expect(a).not.toContain("acc-b");
    expect(a).not.toContain("job-1");
    const b = (await audit.list(companyB, { limit: "200" })).data.map((r) => r.entityId);
    expect(b).toContain("acc-b");
    expect(b).not.toContain("acc-1");
    expect(b).not.toContain("legacy-1");
    expect((await audit.list(newId(), {})).data).toHaveLength(0);
  });

  it("returns what changed (before and after) and who did it, newest first", async () => {
    await logAs(userA, "employee.updated", "Employee", "emp-1", { before: { name: "Old" }, after: { name: "New" } });
    const rows = (await audit.list(companyA, { entityId: "emp-1" })).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: userA, actorEmail: `a-${userA}@audit.test`, action: "employee.updated", before: { name: "Old" }, after: { name: "New" } });
    const all = (await audit.list(companyA, { limit: "200" })).data;
    const times = all.map((r) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("filters by type, action text, actor and date, and pages", async () => {
    await logAs(userA, "journal_entry.posted", "JournalEntry", "je-1");
    await logAs(userA, "journal_entry.posted", "JournalEntry", "je-2");
    expect((await audit.list(companyA, { entityType: "JournalEntry" })).data.map((r) => r.entityId).sort()).toEqual(["je-1", "je-2"]);
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
});
