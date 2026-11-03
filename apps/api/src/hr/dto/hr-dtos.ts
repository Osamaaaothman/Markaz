import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

// ── Allowance types ────────────────────────────────────────────────────────────

export class CreateAllowanceTypeDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{0,29}$/, { message: "code must be letters, digits or underscore, starting with a letter" })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isHousing?: boolean;

  @IsOptional()
  @IsBoolean()
  inGosiBase?: boolean;

  @IsOptional()
  @IsBoolean()
  inEosbBase?: boolean;
}

export class UpdateAllowanceTypeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  inGosiBase?: boolean;

  @IsOptional()
  @IsBoolean()
  inEosbBase?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Employees ──────────────────────────────────────────────────────────────────

export class EmployeeAllowanceDto {
  @IsString()
  @IsNotEmpty()
  allowanceTypeId!: string;

  @IsDecimalString()
  amount!: string;
}

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  nationalId!: string;

  @IsBoolean()
  isSaudi!: boolean;

  @IsOptional()
  @IsBoolean()
  gosiLegacyTrack?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(34)
  bankIban!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsDateString()
  hireDate!: string;

  @IsDecimalString({ positive: true })
  basicSalary!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeAllowanceDto)
  allowances?: EmployeeAllowanceDto[];
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isSaudi?: boolean;

  @IsOptional()
  @IsBoolean()
  gosiLegacyTrack?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  bankIban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsDecimalString({ positive: true })
  basicSalary?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeAllowanceDto)
  allowances?: EmployeeAllowanceDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EmployeesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  includeInactive?: "true" | "false";
}

// ── Payroll runs ─────────────────────────────────────────────────────────────

export class CreatePayrollRunDto {
  @IsInt()
  @Min(2020)
  @Max(2100)
  periodYear!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;

  @IsDateString()
  runDate!: string;
}

// ── Salary advances ──────────────────────────────────────────────────────────

export class GrantSalaryAdvanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsDateString()
  grantDate!: string;

  @IsDecimalString({ positive: true })
  amount!: string;

  @IsDecimalString({ positive: true })
  installmentAmount!: string;

  @IsString()
  @IsNotEmpty()
  cashAccountId!: string;
}

export class RepaySalaryAdvanceDto {
  @IsDateString()
  repaymentDate!: string;

  @IsDecimalString({ positive: true })
  amount!: string;

  @IsString()
  @IsNotEmpty()
  cashAccountId!: string;
}

// ── End of service ───────────────────────────────────────────────────────────

const END_OF_SERVICE_REASONS = ["RESIGNATION", "TERMINATION", "OTHER"] as const;

// ── Company WPS settings ─────────────────────────────────────────────────────

export class SetWpsSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  bankSarieId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(34)
  bankAccountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  molEstablishmentId!: string;
}

export class SettleEndOfServiceDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsDateString()
  terminationDate!: string;

  @IsIn(END_OF_SERVICE_REASONS)
  reason!: (typeof END_OF_SERVICE_REASONS)[number];
}
