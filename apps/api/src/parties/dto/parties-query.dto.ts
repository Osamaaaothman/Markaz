import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { PARTY_KINDS, type PartyKind } from "./create-party.dto.js";

// docs/07-API-RULES.md §6: filterable fields are whitelisted — a text search, a kind filter,
// and whether to include deactivated parties. Nothing else.
export class PartiesQueryDto {
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
  @IsIn(PARTY_KINDS)
  kind?: PartyKind;

  @IsOptional()
  @IsIn(["true", "false"])
  includeInactive?: "true" | "false";
}
