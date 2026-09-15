import { IsDateString, IsOptional, IsString } from "class-validator";

// docs/07-API-RULES.md §6: "Whitelist sortable and filterable fields" — from/to
// filter on entryDate only, nothing else, and both are optional (an unfiltered
// list is still valid).
export class JournalEntriesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
