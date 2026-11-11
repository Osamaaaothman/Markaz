import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { ChartOfAccountsService } from "../accounting/chart-of-accounts.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { MappingSuggestionService } from "./mapping-suggestions.js";
import { SetupStatusService } from "./setup-status.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("First-run setup — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const chart = new ChartOfAccountsService(prisma, audit);
  const suggestions = new MappingSuggestionService(prisma, mappings, chart);
  const status = new SetupStatusService(prisma);
  const cid = (): string => newId();

  async function company() {
    const companyId = newId();
    const actor = { id: "setup-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `Setup ${companyId}`, defaultCurrency: "SAR" } });
    const make = async (code: string, type: string, postable: boolean, parentId: string | null = null): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `S-${code}-${companyId.slice(-6)}`, companyId, code, name: `Account ${code}`, type, normalBalance: type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT", isPostable: postable, parentId } })).id;
    // A fragment of the seeded chart: the inventory folder under its parents, one postable GRN account, the employees' dues folder.
    const r1 = await make("1", "ASSET", false);
    const c11 = await make("11", "ASSET", false, r1);
    const g11108 = await make("11108", "ASSET", false, c11);
    await make("1110801", "ASSET", false, g11108);
    const r2 = await make("2", "LIABILITY", false);
    const c21 = await make("21", "LIABILITY", false, r2);
    const g21111 = await make("21111", "LIABILITY", false, c21);
    await make("2111102", "LIABILITY", false, g21111);
    await make("2110602", "LIABILITY", true, c21);
    return { companyId, actor };
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("proposes mappings from the chart: create under a folder, map an existing account, map a folder; nothing for a chart without them", async () => {
    const { companyId } = await company();
    const found = await suggestions.suggestions(companyId);
    const by = (key: string) => found.find((s) => s.key === key);
    expect(by("INVENTORY")).toMatchObject({ action: "CREATE_UNDER", folderCode: "1110801", accountCode: "111080101" });
    expect(by("GRNI")).toMatchObject({ action: "MAP_EXISTING", accountCode: "2110602" });
    expect(by("EMPLOYEE_EOSB_PARENT")).toMatchObject({ action: "MAP_FOLDER", folderCode: "2111102" });
    expect(by("ACCOUNTS_PAYABLE")).toBeUndefined(); // its folder is not in this chart
    expect(by("COST_OF_GOODS_SOLD")).toBeUndefined(); // deliberately left to the accountant

    const empty = newId();
    await prisma.company.create({ data: { id: empty, name: `Empty ${empty}`, defaultCurrency: "SAR" } });
    expect(await suggestions.suggestions(empty)).toHaveLength(0);
  });

  it("applies the chosen proposals: creates the account under its folder, maps it, and stops proposing what is done", async () => {
    const { companyId, actor } = await company();
    const results = await suggestions.apply(["INVENTORY", "GRNI", "EMPLOYEE_EOSB_PARENT"], actor, cid());
    expect(results.map((r) => r.status)).toEqual(["APPLIED", "APPLIED", "APPLIED"]);

    const entries = await mappings.list(companyId);
    const inventory = entries.find((e) => e.key === "INVENTORY")!;
    expect(inventory.accountCode).toBe("111080101");
    const created = await prisma.account.findFirstOrThrow({ where: { companyId, code: "111080101" }, include: { parent: true } });
    expect(created).toMatchObject({ type: "ASSET", isPostable: true, isActive: true });
    expect(created.parent!.code).toBe("1110801");
    expect(entries.find((e) => e.key === "GRNI")!.accountCode).toBe("2110602");
    expect(entries.find((e) => e.key === "EMPLOYEE_EOSB_PARENT")!.accountCode).toBe("2111102");
    expect(await prisma.auditLog.count({ where: { entityId: created.id, action: "account.created" } })).toBe(1);

    const after = (await suggestions.suggestions(companyId)).map((s) => s.key);
    expect(after).not.toContain("INVENTORY");
    expect(after).not.toContain("GRNI");
    const again = await suggestions.apply(["INVENTORY"], actor, cid());
    expect(again[0]).toMatchObject({ status: "SKIPPED", reason: "NO_LONGER_APPLICABLE" });
    expect(await prisma.account.count({ where: { companyId, code: { startsWith: "11108010" } } })).toBe(1); // no second account was made
  });

  it("never proposes for or touches another company", async () => {
    const mine = await company();
    const theirs = await company();
    await suggestions.apply(["INVENTORY"], mine.actor, cid());
    expect((await suggestions.suggestions(theirs.companyId)).map((s) => s.key)).toContain("INVENTORY");
    expect(await prisma.accountMapping.count({ where: { companyId: theirs.companyId } })).toBe(0);
  });

  it("recognizes only the current company's active logo attachment", async () => {
    const mine = await company();
    const theirs = await company();
    const addLogo = (companyId: string) => prisma.attachment.create({ data: {
      id: newId(), companyId, ownerType: "COMPANY", ownerId: companyId,
      visibility: "PRIVATE", originalName: "logo.png", contentType: "image/png",
      sizeBytes: 1, sha256: "a".repeat(64), storageProvider: "LOCAL",
      storageKey: newId(), createdBy: "setup-clerk",
    } });
    await addLogo(theirs.companyId);
    const hasLogo = async () => (await status.status(mine.companyId)).steps.find((s) => s.key === "COMPANY_LOGO")?.done;
    expect(await hasLogo()).toBe(false);
    const logo = await addLogo(mine.companyId);
    expect(await hasLogo()).toBe(true);
    await prisma.attachment.update({ where: { id: logo.id }, data: { deletedAt: new Date(), deletedBy: mine.actor.id } });
    expect(await hasLogo()).toBe(false);
  });

  it("reports how far the set-up is, and what is required", async () => {
    const { companyId, actor } = await company();
    const before = await status.status(companyId);
    expect(before.requiredDone).toBe(false);
    expect(before.steps.find((s) => s.key === "ACCOUNT_MAPPINGS")).toMatchObject({ required: true, done: false, progress: { done: 0 } });
    expect(before.steps.find((s) => s.key === "WAREHOUSE")?.done).toBe(false);

    await suggestions.apply(["INVENTORY", "GRNI"], actor, cid());
    await prisma.warehouse.create({ data: { id: newId(), ref: `W-${companyId.slice(-6)}`, companyId, code: "MAIN", name: "Main" } });
    const after = await status.status(companyId);
    expect(after.steps.find((s) => s.key === "ACCOUNT_MAPPINGS")?.progress?.done).toBe(2);
    expect(after.steps.find((s) => s.key === "WAREHOUSE")?.done).toBe(true);
    expect(after.steps.find((s) => s.key === "EMPLOYEE_FOLDERS")).toMatchObject({ required: false, done: false });
    expect(after.requiredDone).toBe(false); // mappings and tax codes are still missing
  });
});
