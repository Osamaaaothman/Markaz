import { ArrayMinSize, IsArray, IsIn } from "class-validator";
import { ACCOUNT_MAPPING_KEYS } from "@erp/core";

export class ApplyMappingSuggestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...ACCOUNT_MAPPING_KEYS], { each: true })
  keys!: (typeof ACCOUNT_MAPPING_KEYS)[number][];
}
