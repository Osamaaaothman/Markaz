import { IsIn, IsOptional } from "class-validator";
import { SUPPORTED_DOCUMENT_LANGUAGES, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { StockLevelsQueryDto } from "./stock-levels-query.dto.js";

const EXPORT_FORMATS = ["csv", "pdf"] as const;

export class StockLevelsExportQueryDto extends StockLevelsQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  @IsOptional()
  @IsIn(SUPPORTED_DOCUMENT_LANGUAGES)
  lang?: SupportedDocumentLanguage;
}
