import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ItemsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  includeInactive?: "true" | "false";
}
