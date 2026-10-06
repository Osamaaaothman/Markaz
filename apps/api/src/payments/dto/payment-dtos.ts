import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { PAYMENT_METHODS, type PaymentDirection, type PaymentMethod } from "@erp/core";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class PaymentAllocationDto {
  @IsString()
  invoiceId!: string;

  @IsDecimalString({ positive: true })
  amount!: string;
}

export class CreatePaymentDto {
  @IsString()
  partyId!: string;

  @IsDateString()
  paymentDate!: string;

  @IsDecimalString({ positive: true })
  amount!: string;

  @IsString()
  cashAccountId!: string;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations!: PaymentAllocationDto[];
}

export class PaymentsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsIn(["RECEIPT", "PAYMENT"])
  direction?: PaymentDirection;

  @IsOptional()
  @IsString()
  partyId?: string;
}

export class OpenInvoicesQueryDto {
  @IsString()
  partyId!: string;

  @IsIn(["RECEIPT", "PAYMENT"])
  direction!: PaymentDirection;
}
