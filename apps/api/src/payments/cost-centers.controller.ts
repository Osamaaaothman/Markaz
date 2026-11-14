import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { CostCenterError, CostCenterService } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";

export class SaveCostCenterDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(50)
  code!: string;

  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(200)
  nameAr?: string;

  @IsIn(["COST_CENTER", "PROJECT", "DEPARTMENT"])
  kind!: "COST_CENTER" | "PROJECT" | "DEPARTMENT";

  @IsBoolean()
  isActive!: boolean;
}

@Controller("v1/cost-centers")
export class CostCentersController {
  constructor(private readonly centers: CostCenterService) {}

  @Get()
  @RequirePermission("cash_expense", "read")
  list(@CurrentUser() actor: CurrentUserPayload) { return this.centers.list(actor.companyId); }

  @Post()
  @RequirePermission("account", "create")
  create(@Body() dto: SaveCostCenterDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return this.save(dto, actor, correlationId);
  }

  @Put(":id")
  @RequirePermission("account", "update")
  update(@Param("id") id: string, @Body() dto: SaveCostCenterDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return this.save(dto, actor, correlationId, id);
  }

  private async save(dto: SaveCostCenterDto, actor: CurrentUserPayload, correlationId: string, id?: string) {
    try { return await this.centers.save(dto, actor, correlationId, id); }
    catch (error) {
      if (!(error instanceof CostCenterError)) throw error;
      const body = { code: error.code, message: error.message };
      if (error.code === "COST_CENTER_NOT_FOUND") throw new NotFoundException(body);
      if (error.code === "COST_CENTER_DUPLICATE") throw new ConflictException(body);
      throw new BadRequestException(body);
    }
  }
}
