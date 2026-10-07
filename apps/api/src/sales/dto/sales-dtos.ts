import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

// A line on a quotation or sales order: an item, or a free-text service line.
export class SalesLineDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsDecimalString({ positive: true })
  quantity!: string;

  @IsDecimalString()
  unitPrice!: string;

  @IsString()
  taxCodeId!: string;
}

export class CreateQuotationDto {
  @IsString()
  customerId!: string;

  @IsDateString()
  quotationDate!: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
}

export class ConvertQuotationDto {
  @IsOptional()
  @IsDateString()
  orderDate?: string;
}

export class CreateSalesOrderDto {
  @IsString()
  customerId!: string;

  @IsDateString()
  orderDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
}

export class SalesInvoiceLineDto extends SalesLineDto {
  // Required with an item: the warehouse the goods leave.
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  salesOrderLineId?: string;

  @IsOptional()
  @IsString()
  revenueAccountId?: string;
}

export class CreateSalesInvoiceDto {
  @IsString()
  customerId!: string;

  @IsDateString()
  invoiceDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceLineDto)
  lines!: SalesInvoiceLineDto[];
}

export class CreditNoteLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description!: string;

  @IsDecimalString({ positive: true })
  quantity!: string;

  @IsDecimalString()
  unitPrice!: string;

  @IsString()
  taxCodeId!: string;

  @IsOptional()
  @IsString()
  revenueAccountId?: string;
}

export class CreateCreditNoteDto {
  @IsDateString()
  creditDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines!: CreditNoteLineDto[];
}

export class QuotationsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsIn(["OPEN", "CONVERTED", "REJECTED", "CANCELLED"])
  status?: "OPEN" | "CONVERTED" | "REJECTED" | "CANCELLED";
}

export class SalesOrdersQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsIn(["OPEN", "PARTIALLY_INVOICED", "INVOICED", "CANCELLED"])
  status?: "OPEN" | "PARTIALLY_INVOICED" | "INVOICED" | "CANCELLED";

  @IsOptional()
  @IsString()
  customerId?: string;
}

export class SalesInvoicesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsIn(["INVOICE", "CREDIT_NOTE"])
  documentType?: "INVOICE" | "CREDIT_NOTE";
}
