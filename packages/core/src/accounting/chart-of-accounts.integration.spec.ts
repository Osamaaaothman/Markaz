import { PrismaClient } from "@erp/db";
import { ACCOUNT_COLORS, newId } from "@erp/shared";
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

  it("moves an account under another group of the same type, with its sub-accounts, and audits it", async () => {
    const banks = await chart.create({ code: "M11", name: "Banks", type: "ASSET", isPostable: false, parentId: groupId }, actorA, cid());
    const other = await chart.create({ code: "M12", name: "Other assets", type: "ASSET", isPostable: false, parentId: groupId }, actorA, cid());
    const bank = await chart.create({ code: "M9001", name: "Bank Al Rajhi", type: "ASSET", isPostable: true, parentId: other.id }, actorA, cid());

    const moved = await chart.move(bank.id, banks.id, actorA, cid());
    expect(moved.parentId).toBe(banks.id);
    expect(moved.code).toBe("M9001"); // the code is not touched

    const events = await prisma.auditLog.findMany({ where: { entityId: bank.id, action: "account.moved" } });
    expect(events).toHaveLength(1);

    // moving a group moves its sub-accounts with it
    const regrouped = await chart.move(banks.id, other.id, actorA, cid());
    expect(regrouped.parentId).toBe(other.id);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: bank.id } })).parentId).toBe(banks.id);
  });

  it("refuses a move into a postable account, another type, itself, or its own descendant", async () => {
    const top = await chart.create({ code: "M8", name: "Movable top", type: "ASSET", isPostable: false }, actorA, cid());
    const child = await chart.create({ code: "M81", name: "Child group", type: "ASSET", isPostable: false, parentId: top.id }, actorA, cid());
    const grand = await chart.create({ code: "M811", name: "Grandchild group", type: "ASSET", isPostable: false, parentId: child.id }, actorA, cid());
    const liability = await chart.create({ code: "M2", name: "Liabilities", type: "LIABILITY", isPostable: false }, actorA, cid());

    expect(await failsWith(chart.move(child.id, leafId, actorA, cid()))).toBe("PARENT_NOT_GROUP");
    expect(await failsWith(chart.move(child.id, liability.id, actorA, cid()))).toBe("TYPE_MISMATCH");
    expect(await failsWith(chart.move(child.id, child.id, actorA, cid()))).toBe("MOVE_INTO_SELF_OR_DESCENDANT");
    expect(await failsWith(chart.move(top.id, grand.id, actorA, cid()))).toBe("MOVE_INTO_SELF_OR_DESCENDANT");
    expect(await failsWith(chart.move(child.id, newId(), actorA, cid()))).toBe("PARENT_NOT_FOUND");
    expect(await failsWith(chart.move(newId(), top.id, actorA, cid()))).toBe("ACCOUNT_NOT_FOUND");
  });

  it("keeps companies apart on a move and drops a colour when a top-level account goes under a parent", async () => {
    const root = await chart.create({ code: "M7", name: "Coloured root", type: "ASSET", isPostable: false, color: ACCOUNT_COLORS[0] }, actorA, cid());
    const target = await chart.create({ code: "M71", name: "Target group", type: "ASSET", isPostable: false, parentId: groupId }, actorA, cid());
    expect(await failsWith(chart.move(root.id, target.id, actorB, cid()))).toBe("ACCOUNT_NOT_FOUND");
    const moved = await chart.move(root.id, target.id, actorA, cid());
    expect(moved.color).toBeNull();
    const back = await chart.move(root.id, null, actorA, cid());
    expect(back.parentId).toBeNull();
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
