import { IsIn, IsOptional, IsUUID } from "class-validator";
import { StockMovementsQueryDto } from "./stock-movements-query.dto.js";

export class StockMovementsExportQueryDto extends StockMovementsQueryDto {
  @IsOptional()
  @IsIn(["csv", "pdf"])
  format?: "csv" | "pdf";

  @IsOptional()
  @IsIn(["ar", "en"])
  lang?: "ar" | "en";

  @IsOptional()
  @IsUUID()
  movementId?: string;
}
