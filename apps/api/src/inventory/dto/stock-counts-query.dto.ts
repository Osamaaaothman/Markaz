import { IsIn, IsOptional, IsString } from "class-validator";

export class StockCountsQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  unpostedOnly?: "true" | "false";
}
