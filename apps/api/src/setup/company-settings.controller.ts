import { Body, ConflictException, Controller, Get, Post, Put } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CompanySettingsError, CompanySettingsService } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
class RenameCompanyDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) nameAr?: string | null;
  @IsInt() @Min(1) version!: number;
}
class CalendarYearDto {
  @IsInt() @Min(1900) @Max(2200) year!: number;
}
async function mapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof CompanySettingsError)
      throw new ConflictException({ code: error.message, message: error.message });
    throw error;
  }
}
@Controller("v1/company/settings")
export class CompanySettingsController {
  constructor(private readonly settings: CompanySettingsService) {}
  @Get() @RequirePermission("company", "read") get(@CurrentUser() actor: CurrentUserPayload) {
    return this.settings.get(actor.companyId);
  }
  @Put() @RequirePermission("company", "update") rename(
    @Body() dto: RenameCompanyDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return mapped(
      this.settings.rename(
        { name: dto.name, nameAr: dto.nameAr ?? null, version: dto.version },
        actor,
        correlationId,
      ),
    );
  }
  @Post("calendar-years") @RequirePermission("company", "update") addYear(
    @Body() dto: CalendarYearDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return mapped(this.settings.addCalendarYear(dto.year, actor, correlationId));
  }
}
