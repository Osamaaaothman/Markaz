import { IsBoolean, IsOptional } from "class-validator";

// Stop (false) or restart (true) an account. `acknowledgeBalance` confirms stopping an account that still has a balance.
export class SetAccountActiveDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsBoolean()
  acknowledgeBalance?: boolean;
}
