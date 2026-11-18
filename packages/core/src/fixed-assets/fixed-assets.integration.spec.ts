import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";
import { PrismaAccountingEngine } from "../accounting/accounting-engine.service.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { TrialBalanceService } from "../accounting/trial-balance.service.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { AssetCategoryService } from "./asset-category.service.js";
import { DepreciationRunService } from "./depreciation-run.service.js";
import { FixedAssetDisposalService } from "./disposal.service.js";
import { FixedAssetError } from "./fixed-asset-common.js";
import { FixedAssetReportsService } from "./fixed-asset-reports.service.js";
import { FixedAssetService } from "./fixed-asset.service.js";

// Real PostgreSQL (docs/10-TESTING-RULES.md §1); skipped without DATABASE_URL.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Fixed assets — real database", () => {
  const prisma = new PrismaClient();
  const audit = new PrismaAuditLogger(prisma);
  const engine = new PrismaAccountingEngine(prisma, new PrismaNumberingService());
  const trialBalance = new TrialBalanceService(prisma);
  const mappings = new AccountMappingService(prisma, audit);
  const categories = new AssetCategoryService(prisma, audit);
  const assets = new FixedAssetService(prisma, engine, mappings, audit);
  // "Today" pinned to the end of 2026 so every month of 2026 can be run.
  const runs = new DepreciationRunService(prisma, engine, audit, () => new Date(Date.UTC(2026, 11, 31)));
  const disposals = new FixedAssetDisposalService(prisma, engine, mappings, audit);
  const reports = new FixedAssetReportsService(prisma);

  const cid = (): string => newId();
  const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

  async function company() {
    const companyId = newId();
    const actor = { id: "fa-clerk", companyId };
    await prisma.company.create({ data: { id: companyId, name: `Fixed Assets ${companyId}`, defaultCurrency: "SAR" } });
    const fy = await prisma.fiscalYear.create({ data: { id: newId(), companyId, name: `FY2026-${companyId.slice(-6)}`, startDate: d(2026, 1, 1), endDate: d(2026, 12, 31) } });
    for (let m = 1; m <= 12; m++) {
      await prisma.fiscalPeriod.create({ data: { id: newId(), companyId, fiscalYearId: fy.id, periodNumber: m, startDate: d(2026, m, 1), endDate: new Date(Date.UTC(2026, m, 0)) } });
    }
    const make = async (code: string, type: string, normalBalance?: string): Promise<string> =>
      (await prisma.account.create({ data: { id: newId(), ref: `T-${code}-${companyId.slice(-6)}`, companyId, code, name: code, type, normalBalance: normalBalance ?? (type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT") } })).id;
    const acc = {
      bank: await make("1010", "ASSET"),
      vehicles: await make("1210", "ASSET"),
      vehiclesAcc: await make("1219", "ASSET", "CREDIT"),
      land: await make("1220", "ASSET"),
      depExpense: await make("6210", "EXPENSE"),
      loss: await make("6290", "EXPENSE"),
      equity: await make("3900", "EQUITY"),
    };
    await mappings.set("FIXED_ASSET_DISPOSAL_LOSS", acc.loss, actor, cid());
    await mappings.set("OPENING_BALANCE_EQUITY", acc.equity, actor, cid());
    const vehicles = await categories.create(
      { code: "VEH", name: "Vehicles", nameAr: "سيارات", numberPrefix: "VEH", isDepreciable: true, defaultUsefulLifeMonths: 12, defaultResidualPercent: "0", assetAccountId: acc.vehicles, accumulatedDepreciationAccountId: acc.vehiclesAcc, depreciationExpenseAccountId: acc.depExpense },
      actor,
      cid(),
    );
    const land = await categories.create({ code: "LND", name: "Land", numberPrefix: "LND", isDepreciable: false, assetAccountId: acc.land }, actor, cid());
    return { companyId, actor, acc, vehicles, land };
  }
  type Tenant = Awaited<ReturnType<typeof company>>;

  async function balance(t: Tenant, accountId: string): Promise<number> {
    const row = (await trialBalance.compute(t.companyId)).lines.find((l) => l.accountId === accountId);
    return row ? Number(row.debitTotal) - Number(row.creditTotal) : 0;
  }
  async function failsWith(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "no error";
    } catch (error) {
      if (error instanceof FixedAssetError) return error.code;
      throw error;
    }
  }
  async function assertBooksAgree(t: Tenant, asOf = d(2026, 12, 31)): Promise<void> {
    expect((await trialBalance.compute(t.companyId)).isBalanced).toBe(true);
    const rec = await reports.reconciliation(t.companyId, asOf);
    expect(rec.rows.filter((r) => !Number(r.difference) === false)).toEqual([]);
    expect(rec.isReconciled).toBe(true);
  }
  const car = (t: Tenant, over: Partial<{ cost: string; inService: Date; acquired: Date }> = {}) =>
    assets.createDraft({ name: "Toyota Hilux", categoryId: t.vehicles.id, acquisitionDate: over.acquired ?? d(2026, 1, 1), inServiceDate: over.inService ?? d(2026, 1, 1), acquisitionCost: over.cost ?? "12000" }, t.actor, cid());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("capitalises a draft: numbered in its category series, balanced entry, register equals ledger", async () => {
    const t = await company();
    const draft = await car(t);
    expect(draft.number).toBe("VEH-000001");
    expect(draft.status).toBe("DRAFT");
    const posted = await assets.capitalize(draft.id, t.acc.bank, t.actor, cid(), newId());
    expect(posted.journalEntryId).toBeTruthy();
    expect(await balance(t, t.acc.vehicles)).toBeCloseTo(12000, 4);
    expect(await balance(t, t.acc.bank)).toBeCloseTo(-12000, 4);
    expect((await assets.get(draft.id, t.companyId))!.status).toBe("ACTIVE");
    expect(await failsWith(assets.capitalize(draft.id, t.acc.bank, t.actor, cid(), newId()))).toBe("ASSET_NOT_DRAFT");
    expect(await failsWith(assets.updateDraft(draft.id, { name: "x", categoryId: t.vehicles.id, acquisitionDate: d(2026, 1, 1), inServiceDate: d(2026, 1, 1), acquisitionCost: "1" }, t.actor, cid()))).toBe("ASSET_NOT_DRAFT");
    expect(await failsWith(assets.deleteDraft(draft.id, t.actor, cid()))).toBe("ASSET_NOT_DRAFT");
    await assertBooksAgree(t);
  });

  it("refuses to capitalise from one of the category's own accounts", async () => {
    const t = await company();
    const draft = await car(t);
    expect(await failsWith(assets.capitalize(draft.id, t.acc.vehiclesAcc, t.actor, cid(), newId()))).toBe("SOURCE_ACCOUNT_INVALID");
  });

  it("runs monthly depreciation by the day, refuses a second run of the same month and runs out of order", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    const preview = await runs.preview({ periodYear: 2026, periodMonth: 1 }, t.companyId);
    expect(preview.totalAmount).toBe("1019.1800");
    const jan = await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    expect(jan.totalAmount).toBe(preview.totalAmount);
    expect(jan.number).toMatch(/^DEP-/);
    expect(await balance(t, t.acc.depExpense)).toBeCloseTo(1019.18, 4);
    expect(await balance(t, t.acc.vehiclesAcc)).toBeCloseTo(-1019.18, 4);
    expect(await failsWith(runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId()))).toBe("RUN_EXISTS");
    await runs.post({ periodYear: 2026, periodMonth: 3 }, t.actor, cid(), newId());
    expect(await failsWith(runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId()))).toBe("RUN_BEFORE_LATEST");
    expect(await failsWith(runs.post({ periodYear: 2027, periodMonth: 2 }, t.actor, cid(), newId()))).toBe("FUTURE_PERIOD");
    await assertBooksAgree(t);
  });

  it("catches up an asset brought in late, flagging the catch-up line", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    await runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId());
    const late = await car(t, { cost: "6000", acquired: d(2026, 1, 15), inService: d(2026, 1, 15) });
    expect(late.number).toBe("VEH-000002");
    await assets.capitalize(late.id, t.acc.bank, t.actor, cid(), newId());
    const mar = await runs.post({ periodYear: 2026, periodMonth: 3 }, t.actor, cid(), newId());
    const line = mar.lines.find((l) => l.assetId === late.id)!;
    expect(line.isCatchUp).toBe(true);
    expect(line.fromDate).toBe("2026-01-15");
    expect(line.toDate).toBe("2026-03-31");
    expect(mar.lines.find((l) => l.assetId === a.id)!.isCatchUp).toBe(false);
    await assertBooksAgree(t);
  });

  it("depreciates to exactly zero over the life, then marks the asset fully depreciated and stops", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    for (let m = 1; m <= 12; m++) await runs.post({ periodYear: 2026, periodMonth: m }, t.actor, cid(), newId());
    const after = (await assets.get(a.id, t.companyId))!;
    expect(after.status).toBe("FULLY_DEPRECIATED");
    expect(after.netBookValue).toBe("0.0000");
    expect(after.depreciationHistory).toHaveLength(12);
    expect(await balance(t, t.acc.vehiclesAcc)).toBeCloseTo(-12000, 4);
    await assertBooksAgree(t);
  });

  it("reverses only the latest run, restoring every asset, and the month can then be run again", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    const jan = await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    const feb = await runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId());
    expect(await failsWith(runs.reverse(jan.id, "wrong", t.actor, cid(), newId()))).toBe("RUN_NOT_LATEST");
    const reversed = await runs.reverse(feb.id, "Cost center was wrong", t.actor, cid(), newId());
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.reversalJournalEntryId).toBeTruthy();
    expect(await failsWith(runs.reverse(feb.id, "again", t.actor, cid(), newId()))).toBe("RUN_ALREADY_REVERSED");
    const asset = (await assets.get(a.id, t.companyId))!;
    expect(asset.depreciatedThrough).toBe("2026-01-31");
    expect(asset.accumulatedDepreciation).toBe(jan.totalAmount);
    expect(await balance(t, t.acc.vehiclesAcc)).toBeCloseTo(-Number(jan.totalAmount), 4);
    const again = await runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId());
    expect(again.totalAmount).toBe(feb.totalAmount);
    await assertBooksAgree(t);
  });

  it("disposes of an asset: depreciation up to the day, cost and depreciation leave the ledger, the rest is a loss", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    const preview = await disposals.preview(a.id, d(2026, 2, 10), t.companyId);
    expect(preview.finalDepreciationDays).toBe(10);
    // 12000 x 41/365 = 1347.95 total by 10 Feb; 1019.18 already taken.
    expect(preview.finalDepreciationAmount).toBe("328.7700");
    expect(preview.netBookValue).toBe("10652.0500");
    const done = await disposals.dispose(a.id, { disposalDate: d(2026, 2, 10), disposalType: "SCRAP", reason: "Accident" }, t.actor, cid(), newId());
    expect(done.gainLoss).toBe("-10652.0500");
    expect(done.number).toMatch(/^FAD-/);
    expect(await balance(t, t.acc.vehicles)).toBeCloseTo(0, 4);
    expect(await balance(t, t.acc.vehiclesAcc)).toBeCloseTo(0, 4);
    expect(await balance(t, t.acc.loss)).toBeCloseTo(10652.05, 4);
    expect((await assets.get(a.id, t.companyId))!.status).toBe("DISPOSED");
    // A disposed asset takes no part in later runs, and the run before its disposal can no longer be reversed.
    const janRun = (await runs.list(t.companyId))[0]!;
    expect(await failsWith(runs.reverse(janRun.id, "x", t.actor, cid(), newId()))).toBe("RUN_HAS_DISPOSED_ASSET");
    expect(await failsWith(runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId()))).toBe("NOTHING_TO_DEPRECIATE");
    await assertBooksAgree(t);
  });

  it("refuses a disposal dated before depreciation already posted", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    await runs.post({ periodYear: 2026, periodMonth: 2 }, t.actor, cid(), newId());
    expect(await failsWith(disposals.dispose(a.id, { disposalDate: d(2026, 2, 10), disposalType: "LOSS", reason: "x" }, t.actor, cid(), newId()))).toBe("DISPOSAL_BEFORE_DEPRECIATED");
  });

  it("registers an opening asset with its prior depreciation against opening equity, and continues from there", async () => {
    const t = await company();
    const opening = await assets.registerOpening(
      { name: "Old truck", categoryId: t.vehicles.id, acquisitionDate: d(2025, 1, 1), inServiceDate: d(2025, 1, 1), acquisitionCost: "24000", usefulLifeMonths: 24, openingAccumulatedDepreciation: "12000", openingAsOfDate: d(2026, 1, 1) },
      t.actor,
      cid(),
      newId(),
    );
    expect(await balance(t, t.acc.vehicles)).toBeCloseTo(24000, 4);
    expect(await balance(t, t.acc.vehiclesAcc)).toBeCloseTo(-12000, 4);
    expect(await balance(t, t.acc.equity)).toBeCloseTo(-12000, 4);
    await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    const asset = (await assets.get(opening.id, t.companyId))!;
    expect(asset.depreciationHistory[0]!.fromDate).toBe("2026-01-02");
    await assertBooksAgree(t);
  });

  it("never depreciates land, and a land asset cannot carry opening depreciation", async () => {
    const t = await company();
    const plot = await assets.createDraft({ name: "Plot", categoryId: t.land.id, acquisitionDate: d(2026, 1, 1), inServiceDate: d(2026, 1, 1), acquisitionCost: "500000" }, t.actor, cid());
    await assets.capitalize(plot.id, t.acc.bank, t.actor, cid(), newId());
    expect(await failsWith(runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId()))).toBe("NOTHING_TO_DEPRECIATE");
    expect(
      await failsWith(
        assets.registerOpening({ name: "Plot 2", categoryId: t.land.id, acquisitionDate: d(2020, 1, 1), inServiceDate: d(2020, 1, 1), acquisitionCost: "100", openingAccumulatedDepreciation: "1", openingAsOfDate: d(2026, 1, 1) }, t.actor, cid(), newId()),
      ),
    ).toBe("OPENING_ON_NON_DEPRECIABLE");
    await assertBooksAgree(t);
  });

  it("freezes a category's accounts once one of its assets is in the ledger, and validates account kinds", async () => {
    const t = await company();
    expect(await failsWith(categories.create({ code: "BAD", name: "Bad", numberPrefix: "BAD", isDepreciable: true, defaultUsefulLifeMonths: 12, assetAccountId: t.acc.vehicles, accumulatedDepreciationAccountId: t.acc.bank, depreciationExpenseAccountId: t.acc.depExpense }, t.actor, cid()))).toBe("ACCUMULATED_ACCOUNT_INVALID");
    expect(await failsWith(categories.create({ code: "VEH", name: "Dup", numberPrefix: "XX", isDepreciable: false, assetAccountId: t.acc.land }, t.actor, cid()))).toBe("CATEGORY_CODE_TAKEN");
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    expect(await failsWith(categories.update(t.vehicles.id, { assetAccountId: t.acc.land }, t.actor, cid()))).toBe("CATEGORY_IN_USE");
    const renamed = await categories.update(t.vehicles.id, { name: "Cars" }, t.actor, cid());
    expect(renamed.name).toBe("Cars");
    expect(renamed.isLocked).toBe(true);
  });

  it("transfers an asset and later depreciation follows the new cost center", async () => {
    const t = await company();
    const center = await prisma.costCenter.create({ data: { id: newId(), companyId: t.companyId, code: "CC1", name: "Branch", kind: "COST_CENTER" } });
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    await assets.transfer(a.id, { transferDate: d(2026, 1, 20), costCenterId: center.id, location: "Riyadh", reason: "Moved" }, t.actor, cid());
    expect(await failsWith(assets.transfer(a.id, { transferDate: d(2026, 1, 21), costCenterId: center.id, location: "Riyadh" }, t.actor, cid()))).toBe("NOTHING_CHANGED");
    const run = await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    expect(run.lines[0]!.costCenterId).toBe(center.id);
    const detail = (await assets.get(a.id, t.companyId))!;
    expect(detail.transfers).toHaveLength(1);
    expect(detail.location).toBe("Riyadh");
  });

  it("movement report rolls opening + additions - disposals into closing, per category", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    const b = await car(t, { cost: "6000" });
    await assets.capitalize(b.id, t.acc.bank, t.actor, cid(), newId());
    await runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId());
    await disposals.dispose(b.id, { disposalDate: d(2026, 2, 5), disposalType: "WRITE_OFF", reason: "Stolen" }, t.actor, cid(), newId());
    const report = await reports.movement(t.companyId, d(2026, 1, 1), d(2026, 2, 28));
    const veh = report.rows.find((r) => r.categoryId === t.vehicles.id)!;
    expect(veh.costOpening).toBe("0.0000");
    expect(veh.costAdditions).toBe("18000.0000");
    expect(veh.costDisposals).toBe("6000.0000");
    expect(veh.costClosing).toBe("12000.0000");
    const closingDep = Number(veh.depreciationOpening) + Number(veh.depreciationCharge) - Number(veh.depreciationOnDisposals);
    expect(closingDep).toBeCloseTo(Number(veh.depreciationClosing), 4);
    const register = await reports.register(t.companyId, d(2026, 2, 28));
    expect(register.totals.count).toBe(1);
    await assertBooksAgree(t, d(2026, 2, 28));
  });

  it("two concurrent runs of the same month: exactly one succeeds", async () => {
    const t = await company();
    const a = await car(t);
    await assets.capitalize(a.id, t.acc.bank, t.actor, cid(), newId());
    const results = await Promise.allSettled([runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId()), runs.post({ periodYear: 2026, periodMonth: 1 }, t.actor, cid(), newId())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await assertBooksAgree(t);
  });
});
