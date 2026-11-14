import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import { PAYMENT_METHODS, PAYMENT_COUNTERPARTY_KINDS, type PaymentCounterpartyKind, type PaymentDirection, type PaymentMethod } from "@erp/core";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

export class PaymentAllocationDto {
  @IsString()
  invoiceId!: string;

  @IsDecimalString({ positive: true })
  amount!: string;
}

export class CreatePaymentDto {
  @ValidateIf((dto: CreatePaymentDto) => dto.counterpartyKind !== "ACCOUNT" || dto.partyId !== undefined)
  @IsString()
  @IsNotEmpty()
  partyId?: string;

  @IsOptional()
  @IsIn(PAYMENT_COUNTERPARTY_KINDS)
  counterpartyKind?: PaymentCounterpartyKind;

  @ValidateIf((dto: CreatePaymentDto) => dto.counterpartyKind === "ACCOUNT" || dto.counterpartyKind === "EMPLOYEE" || dto.counterAccountId !== undefined)
  @IsString()
  @IsNotEmpty()
  counterAccountId?: string;

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

export class PaymentCashAccountsQueryDto {
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;
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

export class PartyBalanceQueryDto {
  @IsString()
  partyId!: string;

  @IsIn(["RECEIPT", "PAYMENT"])
  direction!: PaymentDirection;
}

export class CreateCashExpenseLineDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  costCenterId?: string;

  @IsString()
  expenseAccountId!: string;

  @IsDecimalString({ positive: true })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  costCenterRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class CreateCashExpenseDto {
  @IsDateString()
  expenseDate!: string;

  @IsString()
  cashAccountId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCashExpenseLineDto)
  lines!: CreateCashExpenseLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

export class CashExpensesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class SettleDto {
  @IsString()
  partyId!: string;

  @IsIn(["RECEIPT", "PAYMENT"])
  direction!: PaymentDirection;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations!: PaymentAllocationDto[];
}
