import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { UsersService, type CurrentUserProfile, type SafeUser, type UserSummary } from "./users.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { AssignUserRolesDto } from "./dto/assign-user-roles.dto.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { AuthenticatedOnly } from "./authenticated-only.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

@Controller("v1/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Deliberately placed above `:id` routes so the literal path "me" is never
  // swallowed by a future `:id` route.
  @Get("me")
  @AuthenticatedOnly()
  me(@CurrentUser() actor: CurrentUserPayload): Promise<CurrentUserProfile> {
    return this.users.getCurrentUserProfile(actor.id);
  }

  @Get()
  @RequirePermission("user", "read")
  listUsers(@CurrentUser() actor: CurrentUserPayload): Promise<UserSummary[]> {
    return this.users.listUsers(actor.companyId);
  }

  @Post()
  @RequirePermission("user", "create")
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<SafeUser> {
    return this.users.create(dto, actor.id, actor.companyId, correlationId);
  }

  @Put(":id/roles")
  @RequirePermission("role", "assign")
  async assignRoles(
    @Param("id") userId: string,
    @Body() dto: AssignUserRolesDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.users.assignUserRoles(userId, dto.roleIds, actor.id, actor.companyId, correlationId);
  }
}
