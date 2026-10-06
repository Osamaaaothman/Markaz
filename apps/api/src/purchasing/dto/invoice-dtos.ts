import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class SupplierInvoiceLineDto {
  @IsIn(["PO_LINE", "EXPENSE"])
  kind!: "PO_LINE" | "EXPENSE";

  // Required for an order line, forbidden for an expense line.
  @ValidateIf((o: SupplierInvoiceLineDto) => o.kind === "PO_LINE")
  @IsString()
  @IsNotEmpty()
  purchaseOrderLineId?: string;

  // Required for an expense line, forbidden for an order line.
  @ValidateIf((o: SupplierInvoiceLineDto) => o.kind === "EXPENSE")
  @IsString()
  @IsNotEmpty()
  accountId?: string;

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

export class SupplierInvoiceDto {
  @IsString()
  supplierId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  supplierInvoiceNumber!: string;

  @IsDateString()
  invoiceDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  acceptPriceVariance?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineDto)
  lines!: SupplierInvoiceLineDto[];
}

export class SupplierInvoicesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class InvoiceableQueryDto {
  @IsString()
  supplierId!: string;
}

export class CreateTaxCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsDecimalString()
  rate!: string;

  @IsIn(["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"])
  treatment!: "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";
}

export class UpdateTaxCodeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TaxCodesQueryDto {
  @IsOptional()
  @IsIn(["true", "false"])
  includeInactive?: "true" | "false";
}
