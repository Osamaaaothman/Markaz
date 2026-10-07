import { IsIn, IsOptional, IsString } from "class-validator";

export class StockLevelsQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  belowReorderOnly?: "true" | "false";
}
