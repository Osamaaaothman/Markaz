import { IsIn, IsOptional } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

const EXPORT_FORMATS = ["csv", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class ExportQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;

  // No default here deliberately — @Query() DTOs don't run class-transformer
  // defaults before validation the way @Body() does reliably, so the controller
  // applies the "en" fallback itself after validation.
  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}
