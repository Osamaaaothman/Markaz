import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { DocumentDraftService } from "./document-draft.service.js";
import type { IPermissionService, IAuditLogger } from "../contracts.js";
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb("Document drafts", () => {
  const prisma = new PrismaClient();
  let grant = true;
  const permissions: IPermissionService = { can: () => Promise.resolve(grant) };
  const audit: IAuditLogger = { log: jest.fn(async () => {}) };
  const service = new DocumentDraftService(prisma, permissions, audit);
  async function actor(companyId = newId()) {
    await prisma.company.upsert({
      where: { id: companyId },
      create: { id: companyId, name: "Draft test" },
      update: {},
    });
    const id = newId();
    await prisma.user.create({
      data: { id, companyId, email: `${id}@example.test`, passwordHash: "unused", ref: id },
    });
    return { id, companyId };
  }
  afterAll(async () => prisma.$disconnect());
  beforeEach(() => {
    grant = true;
  });
  it("isolates users and companies, persists incomplete forms without journal entries or numbering", async () => {
    const a = await actor(),
      b = await actor(a.companyId),
      c = await actor();
    const id = newId();
    await service.save(id, "sales_invoice", 0, { lines: [{ quantity: "" }], customerId: "" }, a);
    expect((await service.get(id, a)).version).toBe(1);
    for (const other of [b, c]) {
      expect(await service.list(other)).toEqual([]);
      await expect(service.get(id, other)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
      await expect(service.save(id, "sales_invoice", 1, {}, other)).rejects.toMatchObject({
        code: "DRAFT_CONFLICT",
      });
    }
    expect(await prisma.journalEntry.count({ where: { companyId: a.companyId } })).toBe(0);
    expect(await prisma.documentNumberSeries.count({ where: { companyId: a.companyId } })).toBe(0);
  });
  it("rejects stale autosaves and tombstones cannot be resurrected", async () => {
    const a = await actor(),
      id = newId();
    await service.save(id, "quotation", 0, { notes: "first" }, a);
    const results = await Promise.allSettled([
      service.save(id, "quotation", 1, { notes: "one" }, a),
      service.save(id, "quotation", 1, { notes: "two" }, a),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(service.discard(id, 1, a, newId())).rejects.toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    await service.discard(id, 2, a, newId());
    await expect(service.save(id, "quotation", 0, {}, a)).rejects.toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    await expect(service.save(id, "quotation", 3, {}, a)).rejects.toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    expect(await service.list(a)).toEqual([]);
  });
  it("rechecks permissions and rejects unsupported or oversized payloads", async () => {
    const a = await actor();
    await expect(service.save(newId(), "unknown", 0, {}, a)).rejects.toMatchObject({
      code: "DRAFT_INVALID",
    });
    await expect(
      service.save(newId(), "quotation", 0, { notes: "a".repeat(140000) }, a),
    ).rejects.toMatchObject({ code: "DRAFT_INVALID" });
    grant = false;
    await expect(service.save(newId(), "quotation", 0, {}, a)).rejects.toMatchObject({
      code: "DRAFT_FORBIDDEN",
    });
  });
});
