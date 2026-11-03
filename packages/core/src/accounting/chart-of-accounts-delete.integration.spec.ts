import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { PartyService } from "../parties/party.service.js";
import { PrismaAccountingEngine } from "./accounting-engine.service.js";
import { ChartOfAccountsError, ChartOfAccountsService, type ChartOfAccountsErrorCode } from "./chart-of-accounts.service.js";
import { PrismaNumberingService } from "./numbering.service.js";

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

describeIfDb("Deleting and stopping accounts — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const chart = new ChartOfAccountsService(prisma, audit);
  const parties = new PartyService(prisma, audit);
  const mappings = new AccountMappingService(prisma, audit);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const companyId = newId();
  const otherCompanyId = newId();
  const actor = { id: "tester", companyId };
  const outsider = { id: "tester", companyId: otherCompanyId };
  const cid = (): string => newId();

  let periodId: string;
  let groupId: string;
  let codeCounter = 0;

  const make = async (isPostable = true, parentId: string | undefined = groupId): Promise<string> =>
    (await chart.create({ code: `9${++codeCounter}`, name: `Test ${codeCounter}`, type: "ASSET", isPostable, ...(parentId ? { parentId } : {}) }, actor, cid())).id;

  const post = (debitId: string, creditId: string, amount: string): Promise<unknown> =>
    engine.postEntry({
      companyId,
      fiscalPeriodId: periodId,
      entryDate: new Date(),
      postingDate: new Date(),
      currency: "SAR",
      lines: [{ accountId: debitId, debit: amount }, { accountId: creditId, credit: amount }],
      sourceModule: "test",
      sourceDocumentType: "test",
      sourceDocumentId: newId(),
      actorId: actor.id,
      correlationId: cid(),
      idempotencyKey: newId(),
    });

  beforeAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      await prisma.company.create({ data: { id, name: `Delete Test ${id}`, defaultCurrency: "SAR" } });
    }
    const year = new Date().getUTCFullYear();
    const fiscalYear = await prisma.fiscalYear.create({
      data: { id: newId(), companyId, name: `FY${year}-${companyId.slice(0, 6)}`, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
    });
    periodId = (
      await prisma.fiscalPeriod.create({
        data: { id: newId(), companyId, fiscalYearId: fiscalYear.id, periodNumber: 1, startDate: new Date(Date.UTC(year, 0, 1)), endDate: new Date(Date.UTC(year, 11, 31)) },
      })
    ).id;
    groupId = (await chart.create({ code: "9", name: "Test group", type: "ASSET", isPostable: false }, actor, cid())).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes an account nothing uses, audits it, and removes it from the chart", async () => {
    const id = await make();
    expect((await chart.usage(id, actor)).canDelete).toBe(true);
    await chart.delete(id, actor, cid());
    expect(await prisma.account.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "account.deleted" } })).toBe(1);
    expect(await failsWith(chart.delete(id, actor, cid()))).toBe("ACCOUNT_NOT_FOUND");
  });

  it("refuses to delete an account that is used, whatever uses it, and reports what", async () => {
    const posted = await make();
    const counter = await make();
    await post(posted, counter, "10.0000");
    const mapped = await make();
    await mappings.set("INVENTORY", mapped, actor, cid());
    const withParty = await make();
    await chart.update(withParty, { partyId: (await parties.create({ name: "Linked", kind: "PERSON" }, actor, cid())).id }, actor, cid());
    const folder = await make(false);
    await make(true, folder);

    for (const id of [posted, counter, mapped, withParty, folder]) {
      expect(await failsWith(chart.delete(id, actor, cid()))).toBe("ACCOUNT_IN_USE");
      expect(await prisma.account.findUnique({ where: { id } })).not.toBeNull();
      expect((await chart.usage(id, actor)).canDelete).toBe(false);
    }
    expect((await chart.usage(posted, actor)).usage.ledgerLines).toBe(1);
    expect((await chart.usage(mapped, actor)).usage.mappings).toBe(1);
    expect((await chart.usage(folder, actor)).usage.children).toBe(1);
    expect((await chart.usage(withParty, actor)).usage.linkedParty).toBe(true);
  });

  it("keeps companies apart: another company can neither see nor delete the account", async () => {
    const id = await make();
    expect(await failsWith(chart.delete(id, outsider, cid()))).toBe("ACCOUNT_NOT_FOUND");
    expect(await failsWith(chart.usage(id, outsider))).toBe("ACCOUNT_NOT_FOUND");
    expect(await prisma.account.findUnique({ where: { id } })).not.toBeNull();
  });

  it("lets the database refuse a delete the service did not catch (a foreign key)", async () => {
    const posted = await make();
    const counter = await make();
    await post(posted, counter, "5.0000");
    // Straight through the database, bypassing the service's own check.
    await expect(prisma.account.delete({ where: { id: posted } })).rejects.toThrow();
    // And a folder cannot be deleted from under its sub-accounts (the parent key is RESTRICT, not SET NULL).
    const folder = await make(false);
    const child = await make(true, folder);
    await expect(prisma.account.delete({ where: { id: folder } })).rejects.toThrow();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: child } })).parentId).toBe(folder);
  });

  it("stops an account: it keeps its history, takes no new postings, and can be restarted", async () => {
    const a = await make();
    const b = await make();
    await post(a, b, "7.0000");
    // a has a balance: stopping needs an explicit acknowledgement
    expect(await failsWith(chart.setActive(a, false, false, actor, cid()))).toBe("BALANCE_NOT_ZERO");
    expect((await chart.setActive(a, false, true, actor, cid())).isActive).toBe(false);
    await expect(post(a, b, "1.0000")).rejects.toThrow();
    expect(await prisma.journalEntryLine.count({ where: { accountId: a } })).toBe(1); // history stays
    expect((await chart.setActive(a, true, false, actor, cid())).isActive).toBe(true);
    await expect(post(a, b, "1.0000")).resolves.toBeDefined();
    expect(await prisma.auditLog.count({ where: { entityId: a, action: { in: ["account.stopped", "account.restarted"] } } })).toBe(2);
  });

  it("stops an unused or zero-balance account without asking, but not a mapped account or a folder with active accounts", async () => {
    const unused = await make();
    expect((await chart.setActive(unused, false, false, actor, cid())).isActive).toBe(false);

    const x = await make();
    const y = await make();
    await post(x, y, "3.0000");
    await post(y, x, "3.0000"); // nets to zero
    expect((await chart.setActive(x, false, false, actor, cid())).isActive).toBe(false);

    const mapped = await make();
    await mappings.set("GRNI", mapped, actor, cid());
    expect(await failsWith(chart.setActive(mapped, false, true, actor, cid()))).toBe("ACCOUNT_MAPPED");

    const folder = await make(false);
    const inside = await make(true, folder);
    expect(await failsWith(chart.setActive(folder, false, true, actor, cid()))).toBe("HAS_ACTIVE_CHILDREN");
    await chart.setActive(inside, false, true, actor, cid());
    await chart.setActive(folder, false, true, actor, cid());
    // the stopped folder cannot be left with a restarted account under it
    expect(await failsWith(chart.setActive(inside, true, false, actor, cid()))).toBe("PARENT_INACTIVE");
  });
});
