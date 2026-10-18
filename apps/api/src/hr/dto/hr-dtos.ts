import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { IsDecimalString } from "../../common/decimal-string.validator.js";

// ── Employees ──────────────────────────────────────────────────────────────────

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
  @IsDecimalString()
  housingAllowance?: string;

  @IsOptional()
  @IsDecimalString()
  otherAllowances?: string;
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
  @IsDecimalString()
  housingAllowance?: string;

  @IsOptional()
  @IsDecimalString()
  otherAllowances?: string;

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

// ── End of service ───────────────────────────────────────────────────────────

const END_OF_SERVICE_REASONS = ["RESIGNATION", "TERMINATION", "OTHER"] as const;

export class SettleEndOfServiceDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsDateString()
  terminationDate!: string;

  @IsIn(END_OF_SERVICE_REASONS)
  reason!: (typeof END_OF_SERVICE_REASONS)[number];
}
