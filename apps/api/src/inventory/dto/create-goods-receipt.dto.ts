import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class GoodsReceiptLineDto {
  @IsString()
  itemId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}
