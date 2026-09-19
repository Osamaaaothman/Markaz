import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

export class CreateAccountDto {
  // Letters and digits: the accountant's own codes for supplier accounts look like
  // "2110601A0001", so digits-only would reject real-world charts.
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: "code must contain only letters and digits" })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameAr?: string;

  @IsIn(ACCOUNT_TYPES)
  type!: AccountType;

  @IsBoolean()
  isPostable!: boolean;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export function normalBalanceFor(type: AccountType): "DEBIT" | "CREDIT" {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}
