import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class GoodsReceiptLineDto {
  @IsString()
  itemId!: string;

  @IsDecimalString({ positive: true })
  quantity!: string;

  @IsDecimalString()
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
