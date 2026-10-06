import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsDecimalString()
  reorderPoint?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
