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

  // Printed on quotations/orders/invoices for this party (docs/08: never required to create
  // a party — filled in once it's known, same as phone/email). Not validated against the strict
  // ZATCA seller-profile format (compliance.dto.ts): a party can be a non-Saudi party, and this
  // is display data, not an e-invoice field.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  commercialRegistration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  additionalStreetName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  buildingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  additionalNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;
}
