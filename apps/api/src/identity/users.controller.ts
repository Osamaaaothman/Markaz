import { Body, Controller, Post } from "@nestjs/common";
import { UsersService, type SafeUser } from "./users.service.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { RequirePermission } from "./require-permission.decorator.js";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";

@Controller("v1/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

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
