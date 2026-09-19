import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PartyService } from "../parties/party.service.js";
import { ChartOfAccountsError, ChartOfAccountsService, type ChartOfAccountsErrorCode } from "./chart-of-accounts.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

async function failsWith(promise: Promise<unknown>): Promise<ChartOfAccountsErrorCode | "no error"> {
  try {
    await promise;
    return "no error";
  } catch (error) {
    if (error instanceof ChartOfAccountsError) return error.code;
    throw error;
  }
}

describeIfDb("ChartOfAccountsService — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const chart = new ChartOfAccountsService(prisma, audit);
  const parties = new PartyService(prisma, audit);
  const companyA = newId();
  const companyB = newId();
  const actorA = { id: "test-actor", companyId: companyA };
  const actorB = { id: "test-actor", companyId: companyB };
  const cid = (): string => newId();

  let groupId: string;
  let leafId: string;
  let partyA: string;
  let partyOfB: string;

  beforeAll(async () => {
    for (const id of [companyA, companyB]) {
      await prisma.company.create({ data: { id, name: `Chart Test ${id}`, defaultCurrency: "SAR" } });
    }
    groupId = (await chart.create({ code: "1", name: "Assets", type: "ASSET", isPostable: false }, actorA, cid())).id;
    leafId = (await chart.create({ code: "1001", name: "Cash", type: "ASSET", isPostable: true, parentId: groupId }, actorA, cid())).id;
    partyA = (await parties.create({ name: "Ammar", kind: "EMPLOYEE" }, actorA, cid())).id;
    partyOfB = (await parties.create({ name: "Other company person", kind: "PERSON" }, actorB, cid())).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an account linked to a party, with the party's name in the result", async () => {
    const account = await chart.create(
      { code: "1002", name: "Custody", type: "ASSET", isPostable: true, parentId: groupId, partyId: partyA },
      actorA,
      cid(),
    );

    expect(account.party).toEqual({ id: partyA, name: "Ammar", nameAr: null, kind: "EMPLOYEE" });
  });

  it("stores a colour on a top-level account and refuses one on a child", async () => {
    const root = await chart.create({ code: "9", name: "Other", type: "ASSET", isPostable: false, color: "#3B82F6" }, actorA, cid());
    expect(root.color).toBe("#3B82F6");

    expect(await failsWith(chart.create({ code: "1003", name: "X", type: "ASSET", isPostable: true, parentId: groupId, color: "#3B82F6" }, actorA, cid()))).toBe("COLOR_ON_CHILD");
    expect(await failsWith(chart.update(leafId, { color: "#3B82F6" }, actorA, cid()))).toBe("COLOR_ON_CHILD");
  });

  it("changes and clears a colour on a top-level account", async () => {
    const root = await chart.create({ code: "8", name: "Root", type: "ASSET", isPostable: false }, actorA, cid());

    expect((await chart.update(root.id, { color: "#22C55E" }, actorA, cid())).color).toBe("#22C55E");
    expect((await chart.update(root.id, { color: null }, actorA, cid())).color).toBeNull();
  });

  it("refuses a postable parent, a duplicate code and another company's parent", async () => {
    expect(await failsWith(chart.create({ code: "1004", name: "X", type: "ASSET", isPostable: true, parentId: leafId }, actorA, cid()))).toBe("PARENT_NOT_GROUP");
    expect(await failsWith(chart.create({ code: "1001", name: "Dup", type: "ASSET", isPostable: true }, actorA, cid()))).toBe("DUPLICATE_CODE");
    expect(await failsWith(chart.create({ code: "1005", name: "X", type: "ASSET", isPostable: true, parentId: groupId }, actorB, cid()))).toBe("PARENT_NOT_FOUND");
  });

  it("only accepts an active party of the same company", async () => {
    expect(await failsWith(chart.create({ code: "1006", name: "X", type: "ASSET", isPostable: true, parentId: groupId, partyId: partyOfB }, actorA, cid()))).toBe("PARTY_NOT_FOUND");
    expect(await failsWith(chart.update(leafId, { partyId: partyOfB }, actorA, cid()))).toBe("PARTY_NOT_FOUND");

    const inactive = await parties.create({ name: "Retired", kind: "PERSON" }, actorA, cid());
    await parties.update(inactive.id, { isActive: false }, actorA, cid());
    expect(await failsWith(chart.update(leafId, { partyId: inactive.id }, actorA, cid()))).toBe("PARTY_NOT_FOUND");
  });

  it("links an existing account to a party, renames it, then unlinks it", async () => {
    const linked = await chart.update(leafId, { partyId: partyA, name: "  Cash on hand ", nameAr: "نقدية" }, actorA, cid());
    expect(linked).toMatchObject({ name: "Cash on hand", nameAr: "نقدية", partyId: partyA });

    const cleared = await chart.update(leafId, { partyId: null, nameAr: "" }, actorA, cid());
    expect(cleared).toMatchObject({ partyId: null, party: null, nameAr: null, name: "Cash on hand" });
  });

  it("leaves an account untouched by another company", async () => {
    expect(await failsWith(chart.update(leafId, { name: "Hijacked" }, actorB, cid()))).toBe("ACCOUNT_NOT_FOUND");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: leafId } })).name).toBe("Cash on hand");
  });
});
