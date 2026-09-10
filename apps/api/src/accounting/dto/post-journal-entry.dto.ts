import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";

export class JournalLineDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  debit?: string;

  @IsOptional()
  @IsString()
  credit?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class PostJournalEntryDto {
  @IsString()
  fiscalPeriodId!: string;

  @IsDateString()
  entryDate!: string;

  @IsDateString()
  postingDate!: string;

  @IsString()
  @MinLength(3)
  currency!: string;

  @IsOptional()
  @IsString()
  exchangeRate?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];

  @IsString()
  sourceDocumentType!: string;

  @IsString()
  sourceDocumentId!: string;

  @IsString()
  idempotencyKey!: string;
}
