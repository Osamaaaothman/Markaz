import { IsOptional, IsString } from "class-validator";

// The list query shared by goods receipts and stock issues: a page of the newest first, optionally for one warehouse.
export class InventoryDocumentsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}
