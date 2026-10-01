import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, ValidateNested } from "class-validator";

export class StockCountLineDto {
  @IsString()
  itemId!: string;

  @IsString()
  countedQuantity!: string;

  // Required by the service only when nothing is currently on hand for this item.
  @IsOptional()
  @IsString()
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
