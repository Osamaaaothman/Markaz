import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { CompanySettingsService } from "./company-settings.service.js";
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb("Company settings", () => {
  const prisma = new PrismaClient();
  const service = new CompanySettingsService(prisma, { log: async () => {} });
  const actor = { id: "settings-admin", companyId: newId() };
  beforeAll(async () => {
    await prisma.company.create({ data: { id: actor.companyId, name: "Before" } });
  });
  afterAll(async () => prisma.$disconnect());
  it("renames only the active company and rejects a stale version", async () => {
    const other = newId();
    await prisma.company.create({ data: { id: other, name: "Other" } });
    const saved = await service.rename(
      { name: "After", nameAr: "بعد", version: 1 },
      actor,
      newId(),
    );
    expect(saved.name).toBe("After");
    expect(saved.version).toBe(2);
    expect((await service.get(other)).name).toBe("Other");
    await expect(
      service.rename({ name: "Stale", nameAr: null, version: 1 }, actor, newId()),
    ).rejects.toThrow("SETTINGS_CONFLICT");
  });
  it("creates 12 exact monthly periods, including leap day, and prevents concurrent overlap", async () => {
    const results = await Promise.allSettled([
      service.addCalendarYear(2028, actor, newId()),
      service.addCalendarYear(2028, actor, newId()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const periods = await prisma.fiscalPeriod.findMany({
      where: { companyId: actor.companyId },
      orderBy: { periodNumber: "asc" },
    });
    expect(periods).toHaveLength(12);
    expect(periods[1]!.endDate.toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(periods[11]!.endDate.toISOString().slice(0, 10)).toBe("2028-12-31");
  });
});
