import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export class LedgerQueryDto {
  @IsUUID()
  accountId!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

const EXPORT_FORMATS = ["csv", "pdf"] as const;

export class LedgerExportQueryDto extends LedgerQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}
