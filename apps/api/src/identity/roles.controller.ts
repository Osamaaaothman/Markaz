import { Body, Controller, Get, Post } from "@nestjs/common";
import { RolesService, type PermissionEntry, type RoleSummary } from "./roles.service.js";
import { CreateRoleDto } from "./dto/create-role.dto.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

@Controller("v1/roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // Permission catalog is a fixed list seeded at deploy time — every admin
  // who can create roles needs to see it, so `role:read` gates both endpoints.
  @Get("permissions")
  @RequirePermission("role", "read")
  listPermissions(): Promise<PermissionEntry[]> {
    return this.roles.listPermissions();
  }

  @Get()
  @RequirePermission("role", "read")
  listRoles(@CurrentUser() actor: CurrentUserPayload): Promise<RoleSummary[]> {
    return this.roles.listRoles(actor.companyId);
  }

  @Post()
  @RequirePermission("role", "create")
  createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<RoleSummary> {
    return this.roles.createRole(dto, actor.id, actor.companyId, correlationId);
  }
}
