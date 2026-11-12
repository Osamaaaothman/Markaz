import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { MasterDataImportService, validateImportRows } from "./import.service.js";

describe("Import validation", () => {
  it("marks both duplicate rows and keeps quantities as exact strings", () => {
    const rows = validateImportRows("items", [
      {
        rowNumber: 2,
        values: { code: " SKU ", name: "A", unit: "EA", reorderPoint: "999999999999999.9999" },
      },
      { rowNumber: 3, values: { code: "sku", name: "B", unit: "EA" } },
    ]);
    expect(rows.every((row) => row.errors.some((e) => e.code === "DUPLICATE_FILE"))).toBe(true);
    expect(rows[0]!.values.reorderPoint).toBe("999999999999999.9999");
  });
  it("rejects employee provisioning, numeric cells, unknown columns and excessive precision", () => {
    expect(
      validateImportRows("parties", [
        { rowNumber: 2, values: { name: "Worker", kind: "EMPLOYEE", email: "bad" } },
      ])[0]!.errors.map((e) => e.code),
    ).toEqual(expect.arrayContaining(["INVALID_KIND", "INVALID_EMAIL"]));
    const rows = validateImportRows("items", [
      {
        rowNumber: 2,
        values: JSON.parse(
          '{"code":123,"name":"A","unit":"EA","reorderPoint":"1.12345","__proto__":"bad"}',
        ) as Record<string, unknown>,
      },
    ]);
    expect(rows[0]!.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["TEXT_REQUIRED", "UNKNOWN_COLUMN", "INVALID_DECIMAL"]),
    );
  });
});

(process.env.DATABASE_URL ? describe : describe.skip)("Master imports — real PostgreSQL", () => {
  const db = new PrismaClient();
  const service = new MasterDataImportService(db);
  const companyId = newId();
  const otherId = newId();
  const actor = { id: newId(), companyId };
  const item = (code: string, rowNumber = 2) => ({
    rowNumber,
    values: { code, name: `Item ${code}`, unit: "EA", reorderPoint: "4.1234" },
  });
  beforeAll(async () => {
    await db.company.createMany({
      data: [
        { id: companyId, name: "Import QA", defaultCurrency: "SAR" },
        { id: otherId, name: "Other import QA", defaultCurrency: "SAR" },
      ],
    });
    await db.user.create({
      data: { ...actor, ref: "USR-1", email: `${actor.id}@example.test`, passwordHash: "unused" },
    });
  });
  afterAll(() => db.$disconnect());
  it("previews without mutation then imports with audit and detects retries", async () => {
    expect((await service.preview(companyId, "items", [item("A")]))[0]!.errors).toEqual([]);
    expect(await db.item.count({ where: { companyId } })).toBe(0);
    expect(await service.commit("items", [item("A")], actor, newId())).toEqual({ imported: 1 });
    expect(
      (await db.item.findFirstOrThrow({ where: { companyId, code: "A" } })).reorderPoint.toFixed(4),
    ).toBe("4.1234");
    expect(await db.auditLog.count({ where: { companyId, action: "item.imported" } })).toBe(1);
    await expect(service.commit("items", [item("A")], actor, newId())).rejects.toMatchObject({
      message: "IMPORT_INVALID",
    });
    await db.item.updateMany({ where: { companyId, code: "A" }, data: { isActive: false } });
    expect((await service.preview(companyId, "items", [item("a")]))[0]!.errors).toContainEqual({
      field: "code",
      code: "DUPLICATE_EXISTING",
    });
    expect((await service.preview(otherId, "items", [item("A")]))[0]!.errors).toEqual([]);
  });
  it("rejects the whole batch when a later row is invalid", async () => {
    await expect(
      service.commit(
        "items",
        [item("B"), { rowNumber: 3, values: { name: "Missing code" } }],
        actor,
        newId(),
      ),
    ).rejects.toMatchObject({ message: "IMPORT_INVALID" });
    expect(await db.item.count({ where: { companyId, code: "B" } })).toBe(0);
  });
  it("rolls back inserted items and allocated references if the audit insert fails", async () => {
    const before = await db.documentNumberSeries.findFirstOrThrow({ where: { companyId, documentType: "REF_ITM" } });
    // Deliberately violate the real audit table's NOT NULL constraint after item creation.
    await expect(service.commit("items", [item("AUDIT-ROLLBACK")], actor, null as unknown as string)).rejects.toThrow();
    expect(await db.item.count({ where: { companyId, code: "AUDIT-ROLLBACK" } })).toBe(0);
    expect((await db.documentNumberSeries.findUniqueOrThrow({ where: { id: before.id } })).lastNumber).toBe(before.lastNumber);
  });

  it("detects party duplicates on each identifying field and serializes simultaneous imports", async () => {
    const row = {
      rowNumber: 2,
      values: {
        name: "Hospitality",
        kind: "COMPANY",
        email: "buyer@example.test",
        vatNumber: "12345",
      },
    };
    const results = await Promise.allSettled([
      service.commit("parties", [row], actor, newId()),
      service.commit("parties", [row], actor, newId()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.party.count({ where: { companyId } })).toBe(1);
    const preview = await service.preview(companyId, "parties", [
      { rowNumber: 2, values: { ...row.values, name: "Another", email: "BUYER@example.test" } },
    ]);
    expect(preview[0]!.errors).toEqual(
      expect.arrayContaining([
        { field: "email", code: "DUPLICATE_EXISTING" },
        { field: "vatNumber", code: "DUPLICATE_EXISTING" },
      ]),
    );
  });
});
