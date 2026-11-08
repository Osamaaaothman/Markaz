import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const CR_NUMBER_SCHEMES = ["CRN", "MOM", "MLS", "SAG", "OTH", "NAT", "GCC", "IQA", "PAS", "CCN", "CBI"] as const;

// Every field optional: this is a partial update (PATCH-style via PUT), matching
// ComplianceAdminService.updateSellerProfile's `Partial<Record<SellerProfileField, ...>>` input.
export class UpdateSellerProfileDto {
  @IsOptional()
  @Matches(/^3\d{13}3$/, { message: "vatNumber must be 15 digits, starting and ending with 3" })
  vatNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  crNumber?: string;

  @IsOptional()
  @IsIn(CR_NUMBER_SCHEMES)
  crNumberScheme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  additionalStreetName?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: "buildingNumber must be 4 digits" })
  buildingNumber?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: "additionalNumber must be 4 digits" })
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
  @Matches(/^\d{5}$/, { message: "postalCode must be 5 digits" })
  postalCode?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: "countryCode must be 2 uppercase letters, e.g. SA" })
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  nameAr?: string;
}

export class CreateEgsUnitDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branchName?: string;

  @IsString()
  @MaxLength(100)
  businessCategory!: string;

  // "1100" = standard + simplified; each digit is 0/1 per ZATCA's invoice-type flag convention
  // (docs/01-OPEN-DECISIONS.md section S).
  @Matches(/^[01]{4}$/, { message: "invoiceTypes must be 4 characters, each 0 or 1" })
  invoiceTypes!: string;
}

// The OTP from the taxpayer's Fatoora portal. Digits only (the sandbox's own documented sample
// is numeric); never logged or echoed back (docs/09-SECURITY-RULES.md §5).
export class OnboardingOtpDto {
  @Matches(/^\d+$/, { message: "otp must contain digits only" })
  @MaxLength(20)
  otp!: string;
}
