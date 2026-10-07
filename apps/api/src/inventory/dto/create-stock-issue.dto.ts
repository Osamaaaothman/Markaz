import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";

export class StockIssueLineDto {
  @IsString()
  itemId!: string;

  @IsString()
  quantity!: string;
}

export class CreateStockIssueDto {
  @IsString()
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  costCenterRef!: string;

  @IsDateString()
  documentDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockIssueLineDto)
  lines!: StockIssueLineDto[];
}
