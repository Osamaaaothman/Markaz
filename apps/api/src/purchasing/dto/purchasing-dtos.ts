import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
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

// ── Purchase requests ─────────────────────────────────────────────────────────

export class PurchaseRequestLineDto {
  @IsString()
  itemId!: string;

  @IsDecimalString({ positive: true })
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class CreatePurchaseRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestLineDto)
  lines!: PurchaseRequestLineDto[];
}

export class RejectPurchaseRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class PurchaseRequestsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsIn(["PENDING", "PROCESSED", "REJECTED"])
  status?: "PENDING" | "PROCESSED" | "REJECTED";
}

// ── Purchase orders ───────────────────────────────────────────────────────────

export class PurchaseOrderLineDto {
  @IsString()
  itemId!: string;

  @IsDecimalString({ positive: true })
  quantity!: string;

  @IsDecimalString()
  unitPrice!: string;
}

export class CreatePurchaseOrderDto {
  @IsString()
  supplierId!: string;

  @IsDateString()
  orderDate!: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  purchaseRequestId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class PurchaseOrdersQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsIn(["PENDING_APPROVAL", "APPROVED", "REJECTED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"])
  status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class DecidePurchaseOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReceiveLineDto {
  @IsString()
  purchaseOrderLineId!: string;

  @IsDecimalString({ positive: true })
  quantity!: string;
}

export class ReceivePurchaseOrderDto {
  @IsString()
  warehouseId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

// ── Approval policy ───────────────────────────────────────────────────────────

export class SetApprovalPolicyDto {
  // null removes the policy: that document type then never waits for approval.
  @ValidateIf((o: SetApprovalPolicyDto) => o.thresholdAmount !== null)
  @IsDecimalString()
  thresholdAmount!: string | null;
}
