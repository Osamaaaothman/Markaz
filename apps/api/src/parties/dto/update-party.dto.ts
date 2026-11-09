import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { PARTY_KINDS, type PartyKind } from "./create-party.dto.js";

// Every field is optional (a partial update). For the three optional details, an explicit
// `null` (or an empty string) clears the value; leaving the field out keeps it. @IsOptional
// skips validation for both null and undefined, and the service tells them apart.
export class UpdatePartyDto {
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
  @IsIn(PARTY_KINDS)
  kind?: PartyKind;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  commercialRegistration?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  additionalStreetName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  buildingNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  additionalNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
