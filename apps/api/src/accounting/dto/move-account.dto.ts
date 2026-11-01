import { IsOptional, IsString, Matches } from "class-validator";

// Where to move an account: the id of the new parent group, or null (or left out) for the top level.
export class MoveAccountDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  parentId?: string | null;
}
