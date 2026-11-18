import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

// ── Categories ────────────────────────────────────────────────────────────────

export class CreateAssetCategoryDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_-]{0,19}$/, { message: "code must be letters, digits, dash or underscore, starting with a letter" })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,7}$/, { message: "numberPrefix must be 1-8 letters or digits, starting with a letter" })
  numberPrefix!: string;

  @IsBoolean()
  isDepreciable!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  defaultUsefulLifeMonths?: number;

  @IsOptional()
  @IsDecimalString()
  defaultResidualPercent?: string;

  @IsString()
  @IsNotEmpty()
  assetAccountId!: string;

  @IsOptional()
  @IsString()
  accumulatedDepreciationAccountId?: string;

  @IsOptional()
  @IsString()
  depreciationExpenseAccountId?: string;
}

export class UpdateAssetCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,7}$/, { message: "numberPrefix must be 1-8 letters or digits, starting with a letter" })
  numberPrefix?: string;

  @IsOptional()
  @IsBoolean()
  isDepreciable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  defaultUsefulLifeMonths?: number;

  @IsOptional()
  @IsDecimalString()
  defaultResidualPercent?: string;

  @IsOptional()
  @IsString()
  assetAccountId?: string;

  @IsOptional()
  @IsString()
  accumulatedDepreciationAccountId?: string;

  @IsOptional()
  @IsString()
  depreciationExpenseAccountId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Assets ────────────────────────────────────────────────────────────────────

export class FixedAssetDetailsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsDateString({ strict: true })
  acquisitionDate!: string;

  @IsDateString({ strict: true })
  inServiceDate!: string;

  @IsDecimalString({ positive: true })
  acquisitionCost!: string;

  @IsOptional()
  @IsDecimalString()
  residualValue?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsString()
  supplierPartyId?: string;

  @IsOptional()
  @IsString()
  custodianEmployeeId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;
}

export class OpeningAssetDto extends FixedAssetDetailsDto {
  @IsDecimalString()
  openingAccumulatedDepreciation!: string;

  @IsDateString({ strict: true })
  openingAsOfDate!: string;
}

export class UpdateAssetInfoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  supplierPartyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;
}

export class CapitalizeAssetDto {
  @IsString()
  @IsNotEmpty()
  sourceAccountId!: string;
}

export class TransferAssetDto {
  @IsDateString({ strict: true })
  transferDate!: string;

  // Omitted: unchanged. Empty string: cleared.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  custodianEmployeeId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const DISPOSAL_TYPES = ["SCRAP", "LOSS", "WRITE_OFF"] as const;

export class DisposalPreviewQueryDto {
  @IsDateString({ strict: true })
  disposalDate!: string;
}

export class DisposeAssetDto {
  @IsDateString({ strict: true })
  disposalDate!: string;

  @IsIn(DISPOSAL_TYPES)
  disposalType!: (typeof DISPOSAL_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export const ASSET_STATUSES = ["DRAFT", "ACTIVE", "FULLY_DEPRECIATED", "DISPOSED"] as const;

export class FixedAssetsQueryDto {
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: (typeof ASSET_STATUSES)[number];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  custodianEmployeeId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

// ── Depreciation runs ────────────────────────────────────────────────────────

export class DepreciationPeriodDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  periodYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;
}

export class ReverseRunDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export class AsOfQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  asOf?: string;
}

export class MovementQueryDto {
  @IsDateString({ strict: true })
  from!: string;

  @IsDateString({ strict: true })
  to!: string;
}

const EXPORT_FORMATS = ["csv", "pdf"] as const;

export class RegisterExportQueryDto extends AsOfQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}

export class MovementExportQueryDto extends MovementQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}
