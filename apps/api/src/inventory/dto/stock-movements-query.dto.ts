import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export class StockMovementsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn(["RECEIPT", "ISSUE", "COUNT_ADJUSTMENT"])
  movementType?: "RECEIPT" | "ISSUE" | "COUNT_ADJUSTMENT";

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
