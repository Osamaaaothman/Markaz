import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export const PARTY_KINDS = ["COMPANY", "PERSON", "EMPLOYEE", "OTHER"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export class CreatePartyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsIn(PARTY_KINDS)
  kind!: PartyKind;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;
}
