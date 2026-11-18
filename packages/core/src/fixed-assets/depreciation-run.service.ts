import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";
import { monthEnd, monthStart, sliceThrough } from "./depreciation.js";
import { FixedAssetError, ZERO, day, lockAssets, minorUnitDigits, money, profileOf, rethrowProfileError, type FixedAssetActor } from "./fixed-asset-common.js";

export interface DepreciationPeriodInput {
  readonly periodYear: number;
  readonly periodMonth: number; // 1-12
}

export interface DepreciationPreviewLine {
  readonly assetId: string;
  readonly assetNumber: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly categoryName: string;
  readonly categoryNameAr: string | null;
  readonly costCenterId: string | null;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly amount: string;
  readonly accumulatedAfter: string;
  readonly netBookValueAfter: string;
  readonly isCatchUp: boolean;
  readonly fullyDepreciated: boolean;
}

export interface DepreciationPreview {
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalAmount: string;
  readonly lines: readonly DepreciationPreviewLine[];
}

export interface DepreciationRunSummary {
  readonly id: string;
  readonly number: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalAmount: string;
  readonly assetCount: number;
  readonly status: "POSTED" | "REVERSED";
  readonly journalEntryId: string;
  readonly reversalJournalEntryId: string | null;
  readonly reversalReason: string | null;
  readonly reversedAt: string | null;
  readonly createdAt: string;
}

export interface DepreciationRunDetail extends DepreciationRunSummary {
  readonly lines: readonly DepreciationPreviewLine[];
  // Only the latest posted run can be reversed (and only while none of its assets has been disposed of since).
  readonly canReverse: boolean;
}

interface Computed {
  readonly asset: Prisma.FixedAssetGetPayload<{ include: { category: true } }>;
  readonly fromDate: Date;
  readonly toDate: Date;
  readonly days: number;
  readonly amount: Prisma.Decimal;
  readonly accumulatedAfter: Prisma.Decimal;
  readonly isCatchUp: boolean;
  readonly fullyDepreciated: boolean;
}

// One depreciation run per month for the whole register: one balanced journal entry dated the last day of the month, a debit
// to depreciation expense and a credit to accumulated depreciation for every asset (ruling D-FA-3 = A, one line pair per asset),
// carrying the asset's cost center. An asset brought in late is caught up in the next run (lines flagged isCatchUp), never by
// rewriting a past entry. A run is undone only by a reversing entry for the latest run (docs/05 §2).
export class DepreciationRunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly audit: IAuditLogger,
    // Injected so tests can pin "today"; production uses the real clock.
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(companyId: string): Promise<DepreciationRunSummary[]> {
    const runs = await this.prisma.depreciationRun.findMany({
      where: { companyId },
      include: { _count: { select: { lines: true } } },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
    });
    return runs.map((r) => this.summary(r, r._count.lines));
  }

  async get(id: string, companyId: string): Promise<DepreciationRunDetail | null> {
    const run = await this.prisma.depreciationRun.findFirst({
      where: { id, companyId },
      include: { lines: { include: { asset: { include: { category: true } } }, orderBy: { asset: { number: "asc" } } } },
    });
    if (!run) return null;
    const latest = await this.latestPosted(this.prisma, companyId);
    const anyDisposed = run.lines.some((l) => l.asset.status === "DISPOSED");
    return {
      ...this.summary(run, run.lines.length),
      canReverse: run.status === "POSTED" && latest?.id === run.id && !anyDisposed,
      lines: run.lines.map((l) => ({
        assetId: l.assetId,
        assetNumber: l.asset.number,
        assetName: l.asset.name,
        assetNameAr: l.asset.nameAr,
        categoryName: l.asset.category.name,
        categoryNameAr: l.asset.category.nameAr,
        costCenterId: l.costCenterId,
        fromDate: day(l.fromDate)!,
        toDate: day(l.toDate)!,
        days: l.days,
        amount: money(l.amount),
        accumulatedAfter: money(l.accumulatedAfter),
        netBookValueAfter: money(l.netBookValueAfter),
        isCatchUp: l.isCatchUp,
        fullyDepreciated: l.netBookValueAfter.equals(l.asset.residualValue),
      })),
    };
  }

  // What a run for this month would post, without writing anything. Uses exactly the same calculation as post().
  async preview(input: DepreciationPeriodInput, companyId: string): Promise<DepreciationPreview> {
    this.assertPeriodShape(input);
    await this.assertCanRun(this.prisma, companyId, input);
    const computed = await this.compute(this.prisma, companyId, input);
    const currency = await companyCurrency(this.prisma, companyId);
    return {
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      runDate: day(monthEnd(input.periodYear, input.periodMonth))!,
      currency,
      totalAmount: money(computed.reduce((sum, c) => sum.plus(c.amount), ZERO)),
      lines: computed.map((c) => this.previewLine(c)),
    };
  }

  async post(input: DepreciationPeriodInput, actor: FixedAssetActor, correlationId: string, idempotencyKey: string): Promise<DepreciationRunDetail> {
    this.assertPeriodShape(input);
    const runId = newId();
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        // One run at a time per company: two clerks pressing "post" together must not both compute from the same state.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`depreciation:${actor.companyId}`}))`;
        await this.assertCanRun(tx, actor.companyId, input);
        const runDate = monthEnd(input.periodYear, input.periodMonth);
        const period = await findOpenFiscalPeriod(tx, actor.companyId, runDate);
        if (!period) throw new FixedAssetError("NO_OPEN_PERIOD", "No open fiscal period covers the last day of this month");
        const candidates = await this.candidates(tx, actor.companyId, runDate);
        await lockAssets(tx, actor.companyId, candidates.map((a) => a.id));
        const computed = await this.compute(tx, actor.companyId, input);
        if (computed.length === 0) throw new FixedAssetError("NOTHING_TO_DEPRECIATE", "No asset has depreciation due for this month");
        const currency = await companyCurrency(tx, actor.companyId);
        const label = `Depreciation ${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}`;
        const lines: JournalLineInput[] = computed.flatMap((c) => [
          { accountId: c.asset.category.depreciationExpenseAccountId!, debit: money(c.amount), description: `${label} -- ${c.asset.number}`, ...(c.asset.costCenterId ? { costCenterId: c.asset.costCenterId } : {}) },
          { accountId: c.asset.category.accumulatedDepreciationAccountId!, credit: money(c.amount), description: `${label} -- ${c.asset.number}` },
        ]);
        const posting = await this.engine.postEntry(
          {
            companyId: actor.companyId,
            fiscalPeriodId: period.id,
            entryDate: runDate,
            postingDate: runDate,
            currency,
            lines,
            sourceModule: "fixed-assets",
            sourceDocumentType: "depreciation_run",
            sourceDocumentId: runId,
            actorId: actor.id,
            correlationId,
            idempotencyKey,
          },
          tx,
        );
        const number = await allocateDocumentNumber(tx, actor.companyId, "depreciation_run_no", "DEP", await fiscalYearKeyFor(tx, actor.companyId, runDate));
        const total = computed.reduce((sum, c) => sum.plus(c.amount), ZERO);
        await tx.depreciationRun.create({
          data: { id: runId, companyId: actor.companyId, number, periodYear: input.periodYear, periodMonth: input.periodMonth, runDate, currency, totalAmount: total, status: "POSTED", journalEntryId: posting.journalEntryId, actorId: actor.id, correlationId },
        });
        for (const c of computed) {
          await tx.depreciationRunLine.create({
            data: {
              id: newId(),
              companyId: actor.companyId,
              runId,
              assetId: c.asset.id,
              fromDate: c.fromDate,
              toDate: c.toDate,
              days: c.days,
              amount: c.amount,
              previousDepreciatedThrough: c.asset.depreciatedThrough,
              previousStatus: c.asset.status,
              accumulatedAfter: c.accumulatedAfter,
              netBookValueAfter: c.asset.acquisitionCost.minus(c.accumulatedAfter),
              costCenterId: c.asset.costCenterId,
              isCatchUp: c.isCatchUp,
            },
          });
          await tx.fixedAsset.update({
            where: { id: c.asset.id },
            data: { accumulatedDepreciation: c.accumulatedAfter, depreciatedThrough: c.toDate, ...(c.fullyDepreciated ? { status: "FULLY_DEPRECIATED" } : {}), version: { increment: 1 } },
          });
        }
        return { number, total: money(total), assets: computed.length, journalEntryId: posting.journalEntryId };
      },
      { timeout: 60_000 },
    );
    await this.audit.log({ actorId: actor.id, action: "depreciation_run.posted", entityType: "DepreciationRun", entityId: runId, after: { ...outcome, periodYear: input.periodYear, periodMonth: input.periodMonth }, correlationId });
    return (await this.get(runId, actor.companyId))!;
  }

  // Undoes the latest run with a mirror entry dated the same day as the run (so the month nets to zero), and puts every asset
  // back where the run found it. Refused for an older run or once an asset in it has been disposed of.
  async reverse(id: string, reason: string, actor: FixedAssetActor, correlationId: string, idempotencyKey: string): Promise<DepreciationRunDetail> {
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`depreciation:${actor.companyId}`}))`;
        const run = await tx.depreciationRun.findFirst({ where: { id, companyId: actor.companyId }, include: { lines: true } });
        if (!run) throw new FixedAssetError("RUN_NOT_FOUND", "Depreciation run not found");
        if (run.status !== "POSTED") throw new FixedAssetError("RUN_ALREADY_REVERSED", "This run has already been reversed");
        const latest = await this.latestPosted(tx, actor.companyId);
        if (latest?.id !== run.id) throw new FixedAssetError("RUN_NOT_LATEST", "Only the latest depreciation run can be reversed");
        await lockAssets(tx, actor.companyId, run.lines.map((l) => l.assetId));
        const assets = await tx.fixedAsset.findMany({ where: { companyId: actor.companyId, id: { in: run.lines.map((l) => l.assetId) } } });
        const byId = new Map(assets.map((a) => [a.id, a]));
        for (const line of run.lines) {
          const asset = byId.get(line.assetId)!;
          // Anything that moved the asset after this run (a disposal) makes a clean undo impossible.
          if (asset.status === "DISPOSED" || !asset.depreciatedThrough || asset.depreciatedThrough.getTime() !== line.toDate.getTime()) {
            throw new FixedAssetError("RUN_HAS_DISPOSED_ASSET", `Asset ${asset.number} has changed since this run; it cannot be reversed`);
          }
        }
        const period = await findOpenFiscalPeriod(tx, actor.companyId, run.runDate);
        if (!period) throw new FixedAssetError("NO_OPEN_PERIOD", "The run's month is no longer open, so it cannot be reversed");
        const original = await tx.journalEntryLine.findMany({ where: { journalEntryId: run.journalEntryId }, orderBy: { lineNumber: "asc" } });
        const lines: JournalLineInput[] = original.map((l) => ({
          accountId: l.accountId,
          ...(l.debit.greaterThan(0) ? { credit: money(l.debit) } : { debit: money(l.credit) }),
          description: `Reversal of ${run.number} -- ${l.description ?? ""}`.trim(),
          ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
        }));
        const posting = await this.engine.postEntry(
          {
            companyId: actor.companyId,
            fiscalPeriodId: period.id,
            entryDate: run.runDate,
            postingDate: run.runDate,
            currency: run.currency,
            lines,
            sourceModule: "fixed-assets",
            sourceDocumentType: "depreciation_run_reversal",
            sourceDocumentId: run.id,
            actorId: actor.id,
            correlationId,
            idempotencyKey,
          },
          tx,
        );
        for (const line of run.lines) {
          const asset = byId.get(line.assetId)!;
          await tx.fixedAsset.update({
            where: { id: asset.id },
            data: { accumulatedDepreciation: asset.accumulatedDepreciation.minus(line.amount), depreciatedThrough: line.previousDepreciatedThrough, status: line.previousStatus, version: { increment: 1 } },
          });
        }
        await tx.depreciationRun.update({
          where: { id: run.id },
          data: { status: "REVERSED", reversalJournalEntryId: posting.journalEntryId, reversalReason: reason.trim(), reversedAt: new Date(), reversedBy: actor.id },
        });
        return { number: run.number, reversalJournalEntryId: posting.journalEntryId };
      },
      { timeout: 60_000 },
    );
    await this.audit.log({ actorId: actor.id, action: "depreciation_run.reversed", entityType: "DepreciationRun", entityId: id, after: { ...outcome, reason }, correlationId });
    return (await this.get(id, actor.companyId))!;
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────

  private assertPeriodShape(input: DepreciationPeriodInput): void {
    if (!Number.isInteger(input.periodMonth) || input.periodMonth < 1 || input.periodMonth > 12 || !Number.isInteger(input.periodYear) || input.periodYear < 2000) {
      throw new FixedAssetError("FUTURE_PERIOD", "Invalid month");
    }
    const today = this.now();
    if (monthStart(input.periodYear, input.periodMonth) > new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))) {
      throw new FixedAssetError("FUTURE_PERIOD", "A month that has not started yet cannot be depreciated");
    }
  }

  private async latestPosted(db: TransactionClient | PrismaClient, companyId: string) {
    return db.depreciationRun.findFirst({ where: { companyId, status: "POSTED" }, orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }] });
  }

  private async assertCanRun(tx: TransactionClient, companyId: string, input: DepreciationPeriodInput): Promise<void> {
    const same = await tx.depreciationRun.findFirst({ where: { companyId, status: "POSTED", periodYear: input.periodYear, periodMonth: input.periodMonth } });
    if (same) throw new FixedAssetError("RUN_EXISTS", "This month has already been depreciated");
    const latest = await this.latestPosted(tx, companyId);
    if (latest && latest.periodYear * 12 + latest.periodMonth > input.periodYear * 12 + input.periodMonth) {
      throw new FixedAssetError("RUN_BEFORE_LATEST", "A later month has already been depreciated; runs go forward in time");
    }
  }

  private candidates(db: TransactionClient | PrismaClient, companyId: string, runDate: Date) {
    return db.fixedAsset.findMany({
      where: { companyId, status: "ACTIVE", category: { isDepreciable: true }, inServiceDate: { lte: runDate }, capitalizationJournalEntryId: { not: null } },
      include: { category: true },
      orderBy: { number: "asc" },
    });
  }

  private async compute(db: TransactionClient | PrismaClient, companyId: string, input: DepreciationPeriodInput): Promise<Computed[]> {
    const runDate = monthEnd(input.periodYear, input.periodMonth);
    const start = monthStart(input.periodYear, input.periodMonth);
    const assets = await this.candidates(db, companyId, runDate);
    const currency = await companyCurrency(db, companyId);
    const digits = await minorUnitDigits(db, currency);
    const out: Computed[] = [];
    for (const asset of assets) {
      let slice;
      try {
        slice = sliceThrough(profileOf(asset, true, digits), asset.accumulatedDepreciation, asset.depreciatedThrough, runDate);
      } catch (error) {
        rethrowProfileError(error);
      }
      if (!slice) continue;
      out.push({ asset, fromDate: slice.fromDate, toDate: slice.toDate, days: slice.days, amount: slice.amount, accumulatedAfter: slice.accumulatedAfter, isCatchUp: slice.fromDate < start, fullyDepreciated: slice.fullyDepreciated });
    }
    return out;
  }

  private previewLine(c: Computed): DepreciationPreviewLine {
    return {
      assetId: c.asset.id,
      assetNumber: c.asset.number,
      assetName: c.asset.name,
      assetNameAr: c.asset.nameAr,
      categoryName: c.asset.category.name,
      categoryNameAr: c.asset.category.nameAr,
      costCenterId: c.asset.costCenterId,
      fromDate: day(c.fromDate)!,
      toDate: day(c.toDate)!,
      days: c.days,
      amount: money(c.amount),
      accumulatedAfter: money(c.accumulatedAfter),
      netBookValueAfter: money(c.asset.acquisitionCost.minus(c.accumulatedAfter)),
      isCatchUp: c.isCatchUp,
      fullyDepreciated: c.fullyDepreciated,
    };
  }

  private summary(
    r: { id: string; number: string; periodYear: number; periodMonth: number; runDate: Date; currency: string; totalAmount: Prisma.Decimal; status: string; journalEntryId: string; reversalJournalEntryId: string | null; reversalReason: string | null; reversedAt: Date | null; createdAt: Date },
    assetCount: number,
  ): DepreciationRunSummary {
    return {
      id: r.id,
      number: r.number,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      runDate: day(r.runDate)!,
      currency: r.currency,
      totalAmount: money(r.totalAmount),
      assetCount,
      status: r.status as "POSTED" | "REVERSED",
      journalEntryId: r.journalEntryId,
      reversalJournalEntryId: r.reversalJournalEntryId,
      reversalReason: r.reversalReason,
      reversedAt: r.reversedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
