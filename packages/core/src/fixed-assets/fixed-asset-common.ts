import { Prisma } from "@erp/db";
import { newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import { PrismaNumberingService } from "../accounting/numbering.service.js";
import { DepreciationProfileError, type DepreciationProfile } from "./depreciation.js";

// One error type for the whole module; the API maps each code to an HTTP status and the web app to a translated message.
export type FixedAssetErrorCode =
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_CODE_TAKEN"
  | "PREFIX_TAKEN"
  | "CATEGORY_IN_USE"
  | "CATEGORY_INACTIVE"
  | "ASSET_ACCOUNT_INVALID"
  | "ACCUMULATED_ACCOUNT_INVALID"
  | "EXPENSE_ACCOUNT_INVALID"
  | "ACCOUNTS_NOT_DISTINCT"
  | "DEPRECIABLE_NEEDS_ACCOUNTS"
  | "ASSET_NOT_FOUND"
  | "ASSET_NOT_DRAFT"
  | "ASSET_NOT_IN_SERVICE"
  | "SOURCE_ACCOUNT_INVALID"
  | "EMPLOYEE_NOT_FOUND"
  | "COST_CENTER_NOT_FOUND"
  | "SUPPLIER_NOT_FOUND"
  | "IN_SERVICE_BEFORE_ACQUISITION"
  | "NO_OPEN_PERIOD"
  | "RESIDUAL_EXCEEDS_COST"
  | "LIFE_REQUIRED"
  | "OPENING_EXCEEDS_DEPRECIABLE"
  | "OPENING_AFTER_LIFE"
  | "OPENING_DATE_REQUIRED"
  | "OPENING_ON_NON_DEPRECIABLE"
  | "FUTURE_PERIOD"
  | "RUN_EXISTS"
  | "RUN_BEFORE_LATEST"
  | "NOTHING_TO_DEPRECIATE"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_LATEST"
  | "RUN_ALREADY_REVERSED"
  | "RUN_HAS_DISPOSED_ASSET"
  | "DISPOSAL_BEFORE_DEPRECIATED"
  | "DISPOSAL_BEFORE_ACQUISITION"
  | "NOTHING_CHANGED";

export class FixedAssetError extends Error {
  constructor(
    readonly code: FixedAssetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FixedAssetError";
  }
}

export interface FixedAssetActor {
  readonly id: string;
  readonly companyId: string;
}

export const ZERO = new Prisma.Decimal(0);

// Turns a profile error from the pure calculator into the module's own error, so callers handle one type.
export function rethrowProfileError(error: unknown): never {
  if (error instanceof DepreciationProfileError) throw new FixedAssetError(error.code, error.message);
  throw error;
}

export async function minorUnitDigits(tx: TransactionClient, currency: string): Promise<number> {
  const row = await tx.currency.findUnique({ where: { code: currency }, select: { minorUnitDigits: true } });
  return row?.minorUnitDigits ?? 2;
}

interface ProfileSource {
  readonly acquisitionCost: Prisma.Decimal;
  readonly residualValue: Prisma.Decimal;
  readonly usefulLifeMonths: number | null;
  readonly inServiceDate: Date;
  readonly openingAccumulatedDepreciation: Prisma.Decimal;
  readonly openingAsOfDate: Date | null;
}

export function profileOf(asset: ProfileSource, isDepreciable: boolean, digits: number): DepreciationProfile {
  return {
    acquisitionCost: asset.acquisitionCost,
    residualValue: asset.residualValue,
    usefulLifeMonths: asset.usefulLifeMonths,
    inServiceDate: asset.inServiceDate,
    openingAccumulatedDepreciation: asset.openingAccumulatedDepreciation,
    openingAsOfDate: asset.openingAsOfDate,
    isDepreciable,
    minorUnitDigits: digits,
  };
}

// The date an asset's cost reached the ledger: the opening-balance date for an opening asset, otherwise the acquisition date.
export function capitalizationDateOf(asset: { readonly sourceType: string; readonly acquisitionDate: Date; readonly openingAsOfDate: Date | null }): Date {
  return asset.sourceType === "OPENING" && asset.openingAsOfDate ? asset.openingAsOfDate : asset.acquisitionDate;
}

const numbering = new PrismaNumberingService();

// Asset numbers run per category (ruling D-FA-8 = B): VEH-000001, FUR-000001... One gapless series per category, created
// with its prefix on first use, inside the caller's transaction like every other number (docs/02 §3.3).
export async function allocateAssetNumber(tx: TransactionClient, companyId: string, categoryId: string, prefix: string): Promise<string> {
  const documentType = `FIXED_ASSET_${categoryId}`;
  await tx.$executeRaw`
    INSERT INTO document_number_series (id, company_id, document_type, fiscal_year, prefix, padding, last_number, updated_at)
    VALUES (${newId()}, ${companyId}, ${documentType}, ${"ALL"}, ${`${prefix}-`}, ${6}, 0, now())
    ON CONFLICT (company_id, document_type, fiscal_year) DO NOTHING
  `;
  return numbering.next(documentType, { companyId, fiscalYear: "ALL" }, tx);
}

// Row lock on the assets a posting is about to change. fixed_assets is a mutable table (the runtime role has UPDATE), so it can
// be locked; locking in id order keeps two concurrent postings from deadlocking.
export async function lockAssets(tx: TransactionClient, companyId: string, assetIds: readonly string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const ids = [...assetIds].sort();
  await tx.$queryRaw`SELECT id FROM fixed_assets WHERE company_id = ${companyId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

export const money = (value: Prisma.Decimal): string => value.toFixed(4);
export const day = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);
