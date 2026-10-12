import { IsDateString, IsIn, IsOptional } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

const EXPORT_FORMATS = ["csv", "pdf"] as const;

// The period of a trial balance. Both ends are optional: the controller falls back to the start of the current year
// and today, so a bare request still answers.
export class PeriodTrialBalanceQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TrialBalanceExportQueryDto extends PeriodTrialBalanceQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}
