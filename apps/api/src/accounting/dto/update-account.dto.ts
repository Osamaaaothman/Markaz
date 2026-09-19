import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { ACCOUNT_COLORS, type AccountColor } from "@erp/shared";

// A partial update limited to what may change safely on an account that may already have
// postings. For nameAr, partyId and color an explicit null (or "") clears the value; leaving
// the field out keeps it. @IsOptional skips validation for both null and undefined, and the
// controller tells them apart.
export class UpdateAccountDto {
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
  partyId?: string | null;

  @IsOptional()
  @IsIn(ACCOUNT_COLORS)
  color?: AccountColor | null;
}
