import { IsDateString, IsIn, IsOptional } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

const EXPORT_FORMATS = ["csv", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class IncomeStatementExportQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
