import { IsString } from "class-validator";

export class SetAccountMappingDto {
  @IsString()
  accountId!: string;
}
