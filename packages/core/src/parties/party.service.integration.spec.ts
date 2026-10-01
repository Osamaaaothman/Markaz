import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PartyService } from "./party.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL (the erp_app
// runtime role, migrated database), like the other integration specs.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("PartyService — real database", () => {
  const prisma = new PrismaClient();
  const service = new PartyService(prisma, new PrismaAuditLogger(prisma));
  const companyA = newId();
  const companyB = newId();
  const actorA = { id: "test-actor", companyId: companyA };
  const actorB = { id: "test-actor", companyId: companyB };

  beforeAll(async () => {
    for (const id of [companyA, companyB]) {
      await prisma.company.create({ data: { id, name: `Parties Test ${id}`, defaultCurrency: "SAR" } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a party, trims text and stores blank optional details as null", async () => {
    const party = await service.create({ name: "  Ammar  ", nameAr: "  ", kind: "EMPLOYEE", phone: "" }, actorA, newId());

    expect(party).toMatchObject({ name: "Ammar", nameAr: null, kind: "EMPLOYEE", phone: null, email: null, isActive: true });
  });

  it("searches by English name, Arabic name and filters by kind", async () => {
    await service.create({ name: "Acme Supplies", nameAr: "أكمي للتوريد", kind: "COMPANY" }, actorA, newId());

    expect((await service.list(companyA, { q: "acme" })).data.map((p) => p.name)).toEqual(["Acme Supplies"]);
    expect((await service.list(companyA, { q: "للتوريد" })).data.map((p) => p.name)).toEqual(["Acme Supplies"]);
    expect((await service.list(companyA, { kind: "EMPLOYEE" })).data.map((p) => p.name)).toEqual(["Ammar"]);
  });

  it("pages with a cursor without repeating or skipping", async () => {
    const first = await service.list(companyA, { limit: "1" });
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await service.list(companyA, { limit: "1", cursor: first.pageInfo.nextCursor ?? "" });

    expect(second.data).toHaveLength(1);
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    expect(second.pageInfo.hasMore).toBe(false);
  });

  it("updates, clears an optional detail, and hides a deactivated party by default", async () => {
    const created = await service.create({ name: "Temp", kind: "OTHER", phone: "123" }, actorA, newId());
    const updated = await service.update(created.id, { phone: null, isActive: false }, actorA, newId());

    expect(updated).toMatchObject({ phone: null, isActive: false });
    expect((await service.list(companyA, {})).data.some((p) => p.id === created.id)).toBe(false);
    expect((await service.list(companyA, { includeInactive: "true" })).data.some((p) => p.id === created.id)).toBe(true);
  });

  it("never shows or changes another company's party", async () => {
    const mine = await service.create({ name: "Only mine", kind: "PERSON" }, actorA, newId());

    expect((await service.list(companyB, {})).data).toEqual([]);
    expect(await service.update(mine.id, { name: "Hijacked" }, actorB, newId())).toBeNull();
    expect((await service.list(companyA, { q: "Only mine" })).data[0]?.name).toBe("Only mine");
  });
});
