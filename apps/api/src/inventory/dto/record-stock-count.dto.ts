import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, ValidateNested } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class StockCountLineDto {
  @IsString()
  itemId!: string;

  @IsDecimalString()
  countedQuantity!: string;

  // Required by the service only when nothing is currently on hand for this item.
  @IsOptional()
  @IsDecimalString()
  unitCostIfNoStock?: string;
}

export class RecordStockCountDto {
  @IsString()
  warehouseId!: string;

  @IsDateString()
  documentDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockCountLineDto)
  lines!: StockCountLineDto[];
}
