import { IsString, MinLength } from "class-validator";

export class ReverseJournalEntryDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
