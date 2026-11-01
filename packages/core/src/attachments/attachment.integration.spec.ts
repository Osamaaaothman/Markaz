import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { ItemService } from "../inventory/item.service.js";
import { PartyService } from "../parties/party.service.js";
import type { IPermissionService } from "../contracts.js";
import { AttachmentService } from "./attachment.service.js";
import { LocalFileStorage } from "./local-file-storage.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md section 1); skipped without DATABASE_URL (the erp_app runtime role).
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const pdfBytes = (extra = 0): Uint8Array => {
  const header = Array.from(new TextEncoder().encode("%PDF-1.4\n%test document\n"));
  return Uint8Array.from([...header, ...new Array<number>(extra).fill(7)]);
};

// A permission service the test controls: which resources the actor may read.
class FakePermissions implements IPermissionService {
  denied = new Set<string>();
  can(_actorId: string, action: string, resource: string): Promise<boolean> {
    return Promise.resolve(!this.denied.has(`${resource}:${action}`));
  }
}

describeIfDb("AttachmentService — real database and a real folder", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const permissions = new FakePermissions();
  const companyA = newId();
  const companyB = newId();
  const actorA = { id: "att-actor", companyId: companyA };
  const actorB = { id: "att-actor", companyId: companyB };
  let dir: string;
  let service: AttachmentService;
  let partyA: string;
  let partyB: string;
  let itemA: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "markaz-att-it-"));
    service = new AttachmentService(prisma, audit, permissions, new LocalFileStorage(dir), { maxBytes: 4096 });
    for (const id of [companyA, companyB]) await prisma.company.create({ data: { id, name: `Attachments Test ${id}`, defaultCurrency: "SAR" } });
    const parties = new PartyService(prisma, audit);
    partyA = (await parties.create({ name: "Supplier A", kind: "COMPANY" }, actorA, newId())).id;
    partyB = (await parties.create({ name: "Supplier B", kind: "COMPANY" }, actorB, newId())).id;
    itemA = (await new ItemService(prisma, audit).create({ code: "CEM-1", name: "Cement", unit: "EA" }, actorA, newId())).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it("stores a PDF against a record, lists it and gives back exactly the same bytes", async () => {
    const bytes = pdfBytes(100);
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "contract.pdf", bytes }, actorA, newId());

    expect(uploaded).toMatchObject({ ownerType: "PARTY", visibility: "PRIVATE", originalName: "contract.pdf", contentType: "application/pdf", sizeBytes: bytes.length });
    expect(uploaded.ownerLabel).toContain("Supplier A");

    const listed = await service.listForOwner(actorA, "PARTY", partyA);
    expect(listed.map((a) => a.id)).toEqual([uploaded.id]);

    const content = await service.getContent(actorA, uploaded.id);
    expect(Array.from(content.bytes)).toEqual(Array.from(bytes));
    expect(content.contentType).toBe("application/pdf");
  });

  it("never uses the file name to build the storage path", async () => {
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "..\\..\\evil.pdf", bytes: pdfBytes() }, actorA, newId());
    expect(uploaded.originalName).toBe("evil.pdf");
    const shards = await readdir(dir);
    expect(shards.every((name) => /^[0-9a-f]{2}$/.test(name))).toBe(true);
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(row.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f-]{36}$/);
    expect(row.storageKey).not.toContain("evil");
  });

  it("works for a company whose id is not a UUID (the seeded default company is called default-company)", async () => {
    const plainId = `plain-company-${newId()}`;
    await prisma.company.create({ data: { id: plainId, name: "Plain id company", defaultCurrency: "SAR" } });
    const actor = { id: "att-actor", companyId: plainId };
    const party = await new PartyService(prisma, audit).create({ name: "Plain supplier", kind: "COMPANY" }, actor, newId());

    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: party.id, fileName: "plain.pdf", bytes: pdfBytes() }, actor, newId());

    expect(uploaded.originalName).toBe("plain.pdf");
    expect(Array.from((await service.getContent(actor, uploaded.id)).bytes)).toEqual(Array.from(pdfBytes()));
  });

  it("refuses files that are not PDF or images, empty files and oversized files", async () => {
    const text = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "x.pdf", bytes: text }, actorA, newId())).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    await expect(service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "x.pdf", bytes: new Uint8Array(0) }, actorA, newId())).rejects.toMatchObject({ code: "EMPTY_FILE" });
    await expect(service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "x.pdf", bytes: pdfBytes(5000) }, actorA, newId())).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("refuses an unknown record type and a record from another company", async () => {
    await expect(service.upload({ ownerType: "WAREHOUSE", ownerId: partyA, fileName: "x.pdf", bytes: pdfBytes() }, actorA, newId())).rejects.toMatchObject({ code: "INVALID_OWNER_TYPE" });
    await expect(service.upload({ ownerType: "PARTY", ownerId: partyB, fileName: "x.pdf", bytes: pdfBytes() }, actorA, newId())).rejects.toMatchObject({ code: "OWNER_NOT_FOUND" });
    await expect(service.upload({ ownerType: "PARTY", ownerId: newId(), fileName: "x.pdf", bytes: pdfBytes() }, actorA, newId())).rejects.toMatchObject({ code: "OWNER_NOT_FOUND" });
  });

  it("keeps companies apart: another company cannot list or open the file", async () => {
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "private.pdf", bytes: pdfBytes() }, actorA, newId());

    expect((await service.listAll(actorB, {})).data.some((a) => a.id === uploaded.id)).toBe(false);
    expect(await service.listForOwner(actorB, "PARTY", partyA)).toEqual([]);
    await expect(service.getContent(actorB, uploaded.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.remove(actorB, uploaded.id, newId())).toBe(false);
  });

  it("needs the right to read the record itself, and hides the file's existence otherwise", async () => {
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "needs-party-read.pdf", bytes: pdfBytes() }, actorA, newId());
    permissions.denied.add("party:read");
    try {
      await expect(service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "x.pdf", bytes: pdfBytes() }, actorA, newId())).rejects.toMatchObject({ code: "FORBIDDEN_OWNER" });
      await expect(service.listForOwner(actorA, "PARTY", partyA)).rejects.toMatchObject({ code: "FORBIDDEN_OWNER" });
      await expect(service.getContent(actorA, uploaded.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await service.remove(actorA, uploaded.id, newId())).toBe(false);
      expect((await service.listAll(actorA, {})).data.some((a) => a.ownerType === "PARTY")).toBe(false);
    } finally {
      permissions.denied.clear();
    }
  });

  it("detects a stored file that was changed behind the application's back", async () => {
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "tamper.pdf", bytes: pdfBytes(10) }, actorA, newId());
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: uploaded.id } });
    const path = join(dir, row.storageKey);
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("x")]));

    await expect(service.getContent(actorA, uploaded.id)).rejects.toMatchObject({ code: "INTEGRITY_FAILED" });
  });

  it("removes by marking, keeps the row and the file, and audits both events", async () => {
    const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "remove-me.pdf", bytes: pdfBytes(20) }, actorA, newId());

    expect(await service.remove(actorA, uploaded.id, newId())).toBe(true);
    expect(await service.remove(actorA, uploaded.id, newId())).toBe(false);
    expect((await service.listForOwner(actorA, "PARTY", partyA)).some((a) => a.id === uploaded.id)).toBe(false);
    await expect(service.getContent(actorA, uploaded.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe("att-actor");
    expect((await readFile(join(dir, row.storageKey))).length).toBeGreaterThan(0);

    const events = await prisma.auditLog.findMany({ where: { entityId: uploaded.id }, select: { action: true }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["attachment.uploaded", "attachment.removed"]);
  });

  it("marks item pictures PUBLIC and every other record type PRIVATE", async () => {
    const picture = await service.upload({ ownerType: "ITEM", ownerId: itemA, fileName: "cement.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) }, actorA, newId());
    expect(picture.visibility).toBe("PUBLIC");
    const scan = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "scan.pdf", bytes: pdfBytes() }, actorA, newId());
    expect(scan.visibility).toBe("PRIVATE");
  });

  it("pages the company-wide list and filters by file name", async () => {
    const first = await service.listAll(actorA, { limit: "2" });
    expect(first.data).toHaveLength(2);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await service.listAll(actorA, { limit: "2", cursor: first.pageInfo.nextCursor ?? "" });
    expect(second.data.every((a) => !first.data.some((f) => f.id === a.id))).toBe(true);
    expect((await service.listAll(actorA, { q: "cement" })).data.map((a) => a.originalName)).toEqual(["cement.png"]);
  });

  const png = (): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);

  it("keeps the company logo: image only, needs company:update, newest wins, and anyone in the company can read it", async () => {
    const logoCompany = `logo-company-${newId()}`;
    await prisma.company.create({ data: { id: logoCompany, name: "Logo company", defaultCurrency: "SAR" } });
    const actor = { id: "att-actor", companyId: logoCompany };
    expect(await service.getCompanyLogo(logoCompany)).toBeNull();

    await expect(service.upload({ ownerType: "COMPANY", ownerId: logoCompany, fileName: "logo.pdf", bytes: pdfBytes() }, actor, newId())).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    permissions.denied.add("company:update");
    try {
      await expect(service.upload({ ownerType: "COMPANY", ownerId: logoCompany, fileName: "logo.png", bytes: png() }, actor, newId())).rejects.toMatchObject({ code: "FORBIDDEN_OWNER" });
    } finally {
      permissions.denied.clear();
    }
    await expect(service.upload({ ownerType: "COMPANY", ownerId: companyA, fileName: "logo.png", bytes: png() }, actor, newId())).rejects.toMatchObject({ code: "OWNER_NOT_FOUND" });

    const first = await service.upload({ ownerType: "COMPANY", ownerId: logoCompany, fileName: "old.png", bytes: png() }, actor, newId());
    expect(first).toMatchObject({ visibility: "PRIVATE", ownerLabel: "Logo company" });
    const second = await service.upload({ ownerType: "COMPANY", ownerId: logoCompany, fileName: "new.png", bytes: Uint8Array.from([...png(), 9]) }, actor, newId());
    expect((await service.getCompanyLogo(logoCompany))?.originalName).toBe("new.png");
    expect(await service.getCompanyLogo(companyB)).toBeNull();

    expect(await service.remove(actor, second.id, newId())).toBe(true);
    expect((await service.getCompanyLogo(logoCompany))?.originalName).toBe("old.png");
  });

  it("gives each item its newest picture, needs item:update to change it, and refuses a PDF as a picture", async () => {
    const items = new ItemService(prisma, audit);
    await expect(service.upload({ ownerType: "ITEM", ownerId: itemA, fileName: "a.pdf", bytes: pdfBytes() }, actorA, newId())).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    permissions.denied.add("item:update");
    try {
      await expect(service.upload({ ownerType: "ITEM", ownerId: itemA, fileName: "a.png", bytes: png() }, actorA, newId())).rejects.toMatchObject({ code: "FORBIDDEN_OWNER" });
    } finally {
      permissions.denied.clear();
    }
    const first = await service.upload({ ownerType: "ITEM", ownerId: itemA, fileName: "first.png", bytes: png() }, actorA, newId());
    const second = await service.upload({ ownerType: "ITEM", ownerId: itemA, fileName: "second.png", bytes: Uint8Array.from([...png(), 1]) }, actorA, newId());

    const listed = (await items.list(companyA, {})).data.find((i) => i.id === itemA);
    expect(listed?.pictureId).toBe(second.id);
    expect((await service.getItemPicture(companyA, itemA))?.originalName).toBe("second.png");
    expect(await service.getItemPicture(companyB, itemA)).toBeNull();

    await service.remove(actorA, second.id, newId());
    expect((await items.list(companyA, {})).data.find((i) => i.id === itemA)?.pictureId).toBe(first.id);
  });

  describe("database backstops (as the restricted runtime role)", () => {
    it("cannot delete or rewrite an attachment row", async () => {
      const uploaded = await service.upload({ ownerType: "PARTY", ownerId: partyA, fileName: "locked.pdf", bytes: pdfBytes() }, actorA, newId());
      await expect(prisma.$executeRaw`DELETE FROM attachments WHERE id = ${uploaded.id}`).rejects.toThrow(/permission denied/i);
      await expect(prisma.$executeRaw`UPDATE attachments SET original_name = 'changed.pdf' WHERE id = ${uploaded.id}`).rejects.toThrow(/permission denied/i);
      await expect(prisma.$executeRaw`UPDATE attachments SET sha256 = repeat('0', 64) WHERE id = ${uploaded.id}`).rejects.toThrow(/permission denied/i);
    });

    it("refuses a public attachment on anything but an item, even from raw SQL", async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO attachments (id, company_id, owner_type, owner_id, visibility, original_name, content_type, size_bytes, sha256, storage_provider, storage_key, created_by)
          VALUES (${newId()}, ${companyA}, 'SALES_INVOICE', ${newId()}, 'PUBLIC', 'x.pdf', 'application/pdf', 10, repeat('a', 64), 'LOCAL', ${newId()}, 'x')`,
      ).rejects.toThrow(/attachments_public_only_items_check/);
    });
  });
});
