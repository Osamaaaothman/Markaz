import { IsOptional, IsUUID } from "class-validator";
export class ReplenishmentQueryDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() cursor?: string;
}
