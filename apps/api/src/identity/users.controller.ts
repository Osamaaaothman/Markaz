import { Body, Controller, Get, Post } from "@nestjs/common";
import { UsersService, type CurrentUserProfile, type SafeUser } from "./users.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { AuthenticatedOnly } from "./authenticated-only.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

@Controller("v1/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Deliberately placed above `create` so the literal path "me" is never
  // swallowed by a future `:id` route (there isn't one yet, but this ordering is
  // the one that stays correct when one is added).
  @Get("me")
  @AuthenticatedOnly()
  me(@CurrentUser() actor: CurrentUserPayload): Promise<CurrentUserProfile> {
    return this.users.getCurrentUserProfile(actor.id);
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
}
