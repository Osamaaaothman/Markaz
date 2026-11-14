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

  it("searches by English name, Arabic name, ref and filters by kind", async () => {
    const acme = await service.create({ name: "Acme Supplies", nameAr: "أكمي للتوريد", kind: "COMPANY" }, actorA, newId());

    expect((await service.list(companyA, { q: "acme" })).data.map((p) => p.name)).toEqual(["Acme Supplies"]);
    expect((await service.list(companyA, { q: "للتوريد" })).data.map((p) => p.name)).toEqual(["Acme Supplies"]);
    expect((await service.list(companyA, { q: acme.ref })).data.map((p) => p.id)).toEqual([acme.id]);
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

  it("excludes employees before search pagination while retaining them in the party directory", async () => {
    const companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: "Picker filtering", defaultCurrency: "SAR" } });
    const employees = Array.from({ length: 55 }, (_, index) => ({
      id: newId(), companyId, ref: `E-${index}`, name: `A Match Employee ${index}`,
      nameAr: `موظف مشترك ${index}`, kind: "EMPLOYEE",
    }));
    const commercial = ["COMPANY", "PERSON", "OTHER"].map((kind, index) => ({
      id: newId(), companyId, ref: `C-${index}`, name: `Z Match ${index}`,
      nameAr: `جهة مشتركة ${index}`, kind,
    }));
    const inactive = { id: newId(), companyId, ref: "INACTIVE", name: "Z Match inactive", kind: "COMPANY", isActive: false };
    await prisma.party.createMany({ data: [...employees, ...commercial, inactive] });

    // More than a full page of alphabetically earlier employees must not hide customers/suppliers.
    const first = await service.list(companyId, { excludeEmployees: "true", q: "match", limit: "2" });
    expect(first.data.map((party) => party.id)).toEqual(commercial.slice(0, 2).map((party) => party.id));
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await service.list(companyId, { excludeEmployees: "true", q: "match", limit: "2", cursor: first.pageInfo.nextCursor! });
    expect(second.data.map((party) => party.id)).toEqual([commercial[2]!.id]);
    expect(second.pageInfo.hasMore).toBe(false);
    expect((await service.list(companyId, { excludeEmployees: "true", q: "مشترك" })).data).toHaveLength(3);
    expect((await service.list(companyId, { excludeEmployees: "true", q: employees[0]!.ref })).data).toEqual([]);
    expect((await service.list(companyId, { excludeEmployees: "true", includeInactive: "true" })).data).toHaveLength(4);
    expect((await service.list(companyB, { excludeEmployees: "true", q: "match" })).data).toEqual([]);

    expect((await service.list(companyId, { kind: "EMPLOYEE", limit: "100" })).data).toHaveLength(55);
    expect((await service.list(companyId, { excludeEmployees: "false", limit: "100" })).data).toHaveLength(58);
    expect((await service.list(companyId, { limit: "100" })).data).toHaveLength(58);
    expect((await service.list(companyId, { kind: "EMPLOYEE", excludeEmployees: "true" })).data).toEqual([]);
  });

  it("keeps one dual-role party visible in both commercial filters and preserves its identity on reclassification", async () => {
    const companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: "Dual roles", defaultCurrency: "SAR" } });
    const actor = { ...actorA, companyId };
    const customer = await service.create({ name: "A customer", kind: "CUSTOMER" }, actor, newId());
    const supplier = await service.create({ name: "B supplier", kind: "SUPPLIER" }, actor, newId());
    const dual = await service.create({ name: "C dual", kind: "CUSTOMER_SUPPLIER" }, actor, newId());
    expect(dual.accountCodes).toEqual([]);
    const legacy = await service.create({ name: "D legacy", kind: "COMPANY" }, actor, newId());
    expect(await service.update(legacy.id, { kind: "CUSTOMER_SUPPLIER" }, actor, newId()))
      .toMatchObject({ id: legacy.id, ref: legacy.ref, kind: "CUSTOMER_SUPPLIER" });

    expect((await service.list(companyId, { kind: "CUSTOMER" })).data.map((p) => p.id)).toEqual([customer.id, dual.id, legacy.id]);
    expect((await service.list(companyId, { kind: "SUPPLIER" })).data.map((p) => p.id)).toEqual([supplier.id, dual.id, legacy.id]);
    const first = await service.list(companyId, { kind: "CUSTOMER", limit: "2" });
    const next = await service.list(companyId, { kind: "CUSTOMER", limit: "2", cursor: first.pageInfo.nextCursor! });
    expect(next.data.map((p) => p.id)).toEqual([legacy.id]);
    expect((await service.list(companyId, { kind: "SUPPLIER", q: dual.ref })).data.map((p) => p.id)).toEqual([dual.id]);
    expect((await service.list(companyB, { kind: "SUPPLIER", q: dual.ref })).data).toEqual([]);
    expect(await service.update(dual.id, { kind: "OTHER" }, actorB, newId())).toBeNull();
    expect(await prisma.party.count({ where: { companyId } })).toBe(4);
    await service.update(dual.id, { isActive: false }, actor, newId());
    expect((await service.list(companyId, { kind: "CUSTOMER_SUPPLIER" })).data.map((p) => p.id)).toEqual([legacy.id]);
    expect((await service.list(companyId, { kind: "CUSTOMER_SUPPLIER", includeInactive: "true" })).data).toHaveLength(2);
  });

  it("provisions separate customer and supplier accounts for a new dual-role party when both folders are mapped", async () => {
    const companyId = newId();
    await prisma.company.create({ data: { id: companyId, name: "Dual ledgers", defaultCurrency: "SAR" } });
    for (const [index, kind] of ["CUSTOMER", "SUPPLIER"].entries()) {
      const id = newId();
      await prisma.account.create({ data: {
        id, companyId, ref: `PARENT-${index}`, code: `${index + 1}`, name: kind,
        type: kind === "CUSTOMER" ? "ASSET" : "LIABILITY",
        normalBalance: kind === "CUSTOMER" ? "DEBIT" : "CREDIT", isPostable: false,
      } });
      await prisma.accountMapping.create({ data: { id: newId(), companyId, key: `${kind}_LEDGER_PARENT`, accountId: id } });
    }
    const party = await service.create({ name: "Both", kind: "CUSTOMER_SUPPLIER" }, { ...actorA, companyId }, newId());
    expect(party.accountCodes).toHaveLength(2);
    expect(party.accountCode).toBe(party.accountCodes[0]);
    const accounts = await prisma.account.findMany({ where: { companyId, partyId: party.id }, orderBy: { type: "asc" } });
    expect(accounts.map((a) => a.type)).toEqual(["ASSET", "LIABILITY"]);
    expect(new Set(accounts.map((a) => a.code)).size).toBe(2);
  });
});
