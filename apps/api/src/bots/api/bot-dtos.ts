import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

// docs/07-API-RULES.md §3: validated at the boundary. Credential values are free-form strings here;
// each adapter's declared field patterns are checked in BotConnectionService.

const PROVIDERS = ["telegram", "discord"];
const TRANSPORTS = ["webhook", "polling"];
const LANGUAGES = ["ar", "en"];
const REPORT_TYPES = ["DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class TestConnectionDto {
  @IsIn(PROVIDERS)
  provider!: string;

  @IsObject()
  credentials!: Record<string, string>;
}

export class CreateConnectionDto {
  @IsIn(PROVIDERS)
  provider!: string;

  @IsIn(TRANSPORTS)
  transport!: string;

  @IsObject()
  credentials!: Record<string, string>;

  @IsBoolean()
  acceptDataSharing!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  enabledFeatures?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDecimalString()
  approvalCeiling?: string | null;
}

export class UpdateConnectionDto {
  @IsOptional()
  @IsIn(TRANSPORTS)
  transport?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  enabledFeatures?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDecimalString()
  approvalCeiling?: string | null;
}

export class DeliveriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AddTargetDto {
  @IsString()
  @Matches(/^-?\d{1,25}$/, { message: "chatId must be a numeric chat id (use /chatid in that chat)" })
  chatId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;
}

export class SubscriptionDto {
  @IsIn(REPORT_TYPES)
  reportType!: string;

  @Matches(HHMM)
  sendTime!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @IsIn(LANGUAGES)
  language!: string;

  @IsOptional()
  @IsBoolean()
  attachPdf?: boolean;
}

export class LinkCodeDto {
  @IsString()
  connectionId!: string;

  @IsIn(LANGUAGES)
  language!: string;
}

export class PreferencesDto {
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(HHMM)
  quietHoursStart?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(HHMM)
  quietHoursEnd?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  disabledAlerts?: string[];
}

export class MySubscriptionDto extends SubscriptionDto {
  @IsString()
  connectionId!: string;
}
