import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, JournalLineInput, TransactionClient } from "../contracts.js";
import { findOpenFiscalPeriod, fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import type { AccountMappingService } from "../inventory/account-mapping.service.js";
import { allocateDocumentNumber } from "../reference.js";
import { sliceThrough } from "./depreciation.js";
import { FixedAssetError, ZERO, capitalizationDateOf, day, lockAssets, minorUnitDigits, money, profileOf, rethrowProfileError, type FixedAssetActor } from "./fixed-asset-common.js";

export type DisposalType = "SCRAP" | "LOSS" | "WRITE_OFF";

export interface DisposalInput {
  readonly disposalDate: Date;
  readonly disposalType: DisposalType;
  readonly reason: string;
}

export interface DisposalPreview {
  readonly assetId: string;
  readonly disposalDate: string;
  readonly cost: string;
  readonly accumulatedBefore: string;
  readonly finalDepreciationAmount: string;
  readonly finalDepreciationDays: number;
  readonly finalDepreciationFrom: string | null;
  readonly accumulatedAtDisposal: string;
  readonly netBookValue: string;
  // Negative = loss.
  readonly gainLoss: string;
  readonly lines: readonly { readonly accountId: string; readonly accountCode: string; readonly accountName: string; readonly accountNameAr: string | null; readonly debit: string; readonly credit: string }[];
}

export interface DisposalResult {
  readonly id: string;
  readonly number: string;
  readonly assetId: string;
  readonly journalEntryId: string;
  readonly gainLoss: string;
}

interface Plan {
  readonly asset: Prisma.FixedAssetGetPayload<{ include: { category: true } }>;
  readonly final: Prisma.Decimal;
  readonly finalDays: number;
  readonly finalFrom: Date | null;
  readonly finalTo: Date | null;
  readonly accumulatedAtDisposal: Prisma.Decimal;
  readonly bookValue: Prisma.Decimal;
  readonly lines: JournalLineInput[];
}

// Takes an asset off the register (scrapped, lost, written off). Depreciation is first brought up to the disposal day itself,
// pro-rated by the day like every run (ruling D-FA-7, following D-FA-1 = C), inside the same entry. Then the cost and all its
// accumulated depreciation leave the ledger and whatever book value is left is a loss:
//
//   Dr Depreciation expense      final days          Cr Accumulated depreciation  final days
//   Dr Accumulated depreciation  all of it
//   Dr Loss on disposal          book value left     Cr Asset account             cost
//
// Selling an asset to a customer is NOT here: that needs a ZATCA tax invoice (ruling D-FA-5 = A, deferred).
export class FixedAssetDisposalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async preview(assetId: string, disposalDate: Date, companyId: string): Promise<DisposalPreview> {
    const plan = await this.plan(this.prisma, companyId, assetId, disposalDate, false);
    const accounts = await this.prisma.account.findMany({ where: { companyId, id: { in: plan.lines.map((l) => l.accountId) } }, select: { id: true, code: true, name: true, nameAr: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return {
      assetId,
      disposalDate: day(disposalDate)!,
      cost: money(plan.asset.acquisitionCost),
      accumulatedBefore: money(plan.asset.accumulatedDepreciation),
      finalDepreciationAmount: money(plan.final),
      finalDepreciationDays: plan.finalDays,
      finalDepreciationFrom: day(plan.finalFrom),
      accumulatedAtDisposal: money(plan.accumulatedAtDisposal),
      netBookValue: money(plan.bookValue),
      gainLoss: money(plan.bookValue.negated()),
      lines: plan.lines.map((l) => {
        const a = byId.get(l.accountId);
        return { accountId: l.accountId, accountCode: a?.code ?? "", accountName: a?.name ?? "", accountNameAr: a?.nameAr ?? null, debit: l.debit ?? "0.0000", credit: l.credit ?? "0.0000" };
      }),
    };
  }

  async dispose(assetId: string, input: DisposalInput, actor: FixedAssetActor, correlationId: string, idempotencyKey: string): Promise<DisposalResult> {
    const disposalId = newId();
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Same lock as the monthly run, so a disposal and a run never interleave.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`depreciation:${actor.companyId}`}))`;
        await lockAssets(tx, actor.companyId, [assetId]);
        const plan = await this.plan(tx, actor.companyId, assetId, input.disposalDate, true);
        const period = await findOpenFiscalPeriod(tx, actor.companyId, input.disposalDate);
        if (!period) throw new FixedAssetError("NO_OPEN_PERIOD", "No open fiscal period covers the disposal date");
        const posting = await this.engine.postEntry(
          {
            companyId: actor.companyId,
            fiscalPeriodId: period.id,
            entryDate: input.disposalDate,
            postingDate: input.disposalDate,
            currency: plan.asset.currency,
            lines: plan.lines,
            sourceModule: "fixed-assets",
            sourceDocumentType: "fixed_asset_disposal",
            sourceDocumentId: disposalId,
            actorId: actor.id,
            correlationId,
            idempotencyKey,
          },
          tx,
        );
        const number = await allocateDocumentNumber(tx, actor.companyId, "fixed_asset_disposal_no", "FAD", await fiscalYearKeyFor(tx, actor.companyId, input.disposalDate));
        await tx.fixedAssetDisposal.create({
          data: {
            id: disposalId,
            companyId: actor.companyId,
            number,
            assetId,
            disposalDate: input.disposalDate,
            disposalType: input.disposalType,
            costAtDisposal: plan.asset.acquisitionCost,
            accumulatedAtDisposal: plan.accumulatedAtDisposal,
            finalDepreciationAmount: plan.final,
            finalDepreciationDays: plan.finalDays,
            gainLoss: plan.bookValue.negated(),
            reason: input.reason.trim(),
            journalEntryId: posting.journalEntryId,
            actorId: actor.id,
            correlationId,
          },
        });
        await tx.fixedAsset.update({
          where: { id: assetId },
          data: {
            status: "DISPOSED",
            accumulatedDepreciation: plan.accumulatedAtDisposal,
            ...(plan.finalTo ? { depreciatedThrough: plan.finalTo } : {}),
            version: { increment: 1 },
          },
        });
        return { id: disposalId, number, assetId, journalEntryId: posting.journalEntryId, gainLoss: money(plan.bookValue.negated()), assetNumber: plan.asset.number };
      },
      { timeout: 60_000 },
    );
    await this.audit.log({ actorId: actor.id, action: "fixed_asset.disposed", entityType: "FixedAsset", entityId: assetId, after: { ...result, disposalType: input.disposalType, disposalDate: day(input.disposalDate), reason: input.reason }, correlationId });
    return { id: result.id, number: result.number, assetId: result.assetId, journalEntryId: result.journalEntryId, gainLoss: result.gainLoss };
  }

  private async plan(db: TransactionClient | PrismaClient, companyId: string, assetId: string, disposalDate: Date, resolveLoss: boolean): Promise<Plan> {
    const asset = await db.fixedAsset.findFirst({ where: { id: assetId, companyId }, include: { category: true } });
    if (!asset) throw new FixedAssetError("ASSET_NOT_FOUND", "Asset not found");
    if (asset.status !== "ACTIVE" && asset.status !== "FULLY_DEPRECIATED") throw new FixedAssetError("ASSET_NOT_IN_SERVICE", "Only an asset in the ledger and not yet disposed of can be disposed of");
    if (disposalDate < capitalizationDateOf(asset)) throw new FixedAssetError("DISPOSAL_BEFORE_ACQUISITION", "The disposal date cannot be before the asset entered the ledger");
    if (asset.depreciatedThrough && asset.depreciatedThrough > disposalDate) {
      throw new FixedAssetError("DISPOSAL_BEFORE_DEPRECIATED", "Depreciation has already been posted past this date; reverse that run first or choose a later date");
    }
    const digits = await minorUnitDigits(db, asset.currency);
    let slice = null;
    if (asset.category.isDepreciable && asset.status === "ACTIVE") {
      try {
        slice = sliceThrough(profileOf(asset, true, digits), asset.accumulatedDepreciation, asset.depreciatedThrough, disposalDate);
      } catch (error) {
        rethrowProfileError(error);
      }
    }
    const final = slice?.amount ?? ZERO;
    const accumulatedAtDisposal = asset.accumulatedDepreciation.plus(final);
    const bookValue = asset.acquisitionCost.minus(accumulatedAtDisposal);
    const label = `Disposal of ${asset.number} -- ${asset.name}`;
    const lines: JournalLineInput[] = [];
    if (final.greaterThan(0)) {
      lines.push({ accountId: asset.category.depreciationExpenseAccountId!, debit: money(final), description: `${label} -- depreciation to disposal date`, ...(asset.costCenterId ? { costCenterId: asset.costCenterId } : {}) });
      lines.push({ accountId: asset.category.accumulatedDepreciationAccountId!, credit: money(final), description: `${label} -- depreciation to disposal date` });
    }
    if (accumulatedAtDisposal.greaterThan(0)) lines.push({ accountId: asset.category.accumulatedDepreciationAccountId!, debit: money(accumulatedAtDisposal), description: label });
    if (bookValue.greaterThan(0)) {
      // In preview the loss account may not be mapped yet; show the line against the asset account's place so the user sees the
      // amount, and let dispose() fail with the clear "map this key" error.
      const lossAccount = resolveLoss
        ? await this.accountMappings.resolve(db, companyId, "FIXED_ASSET_DISPOSAL_LOSS")
        : ((await db.accountMapping.findUnique({ where: { companyId_key: { companyId, key: "FIXED_ASSET_DISPOSAL_LOSS" } } }))?.accountId ?? "");
      lines.push({ accountId: lossAccount, debit: money(bookValue), description: `${label} -- loss` });
    }
    lines.push({ accountId: asset.category.assetAccountId, credit: money(asset.acquisitionCost), description: label, ...(asset.costCenterId ? { costCenterId: asset.costCenterId } : {}) });
    return { asset, final, finalDays: slice?.days ?? 0, finalFrom: slice?.fromDate ?? null, finalTo: slice?.toDate ?? null, accumulatedAtDisposal, bookValue, lines };
  }
}
