import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: "code must contain only digits" })
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

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
