import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, UnprocessableEntityException } from "@nestjs/common";
import type { IPermissionService } from "@erp/core";
import { CurrentUser, type CurrentUserPayload } from "../../auth/current-user.decorator.js";
import { PERMISSION_SERVICE } from "../../identity/identity.tokens.js";
import { RequirePermission } from "../../identity/require-permission.decorator.js";
import { CreateAccessTokenDto } from "../ai.dtos.js";
import { AccessTokenError, AccessTokenService } from "./access-tokens.js";

// The signed-in user's own personal tokens for the read-only MCP endpoint (POST /v1/ai/mcp).
// These routes take only the login token: a personal token cannot create or revoke tokens.
@Controller("v1/ai/access-tokens")
export class AiAccessTokenController {
  constructor(
    @Inject(AccessTokenService) private readonly tokens: AccessTokenService,
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
  ) {}

  @Get()
  @RequirePermission("ai_assistant", "use")
  list(@CurrentUser() actor: CurrentUserPayload) {
    return this.tokens.list(actor);
  }

  // The response is the only time the token itself is ever shown.
  @Post()
  @RequirePermission("ai_assistant", "use")
  create(@Body() dto: CreateAccessTokenDto, @CurrentUser() actor: CurrentUserPayload) {
    const can = (resource: string, action: string): Promise<boolean> => this.permissions.can(actor.id, action, resource, actor.companyId);
    return mapErrors(this.tokens.create(actor, dto.name, dto.scope ?? "read", can));
  }

  @Delete(":id")
  @RequirePermission("ai_assistant", "use")
  @HttpCode(204)
  revoke(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapErrors(this.tokens.revoke(actor, id));
  }
}

async function mapErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof AccessTokenError)) throw error;
    const body = { message: error.message, code: error.code };
    if (error.code === "TOKEN_NOT_FOUND") throw new NotFoundException(body);
    if (error.code === "TOO_MANY_TOKENS") throw new UnprocessableEntityException(body);
    if (error.code === "FORBIDDEN") throw new ForbiddenException(body);
    throw new BadRequestException(body);
  }
}
