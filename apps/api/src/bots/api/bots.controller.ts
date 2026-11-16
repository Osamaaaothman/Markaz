import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CurrentUser, type CurrentUserPayload } from "../../auth/current-user.decorator.js";
import { CorrelationId } from "../../common/correlation-id.decorator.js";
import { AuthenticatedOnly } from "../../identity/authenticated-only.decorator.js";
import { RequirePermission } from "../../identity/require-permission.decorator.js";
import { BotError } from "../application/bot-core.js";
import { BotConnectionService } from "../application/bot-connection.service.js";
import { BotLinkService } from "../application/bot-link.service.js";
import {
  AddTargetDto,
  CreateConnectionDto,
  DeliveriesQueryDto,
  LinkCodeDto,
  MySubscriptionDto,
  PreferencesDto,
  SubscriptionDto,
  TestConnectionDto,
  UpdateConnectionDto,
} from "./bot-dtos.js";

export async function mapBotErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof BotError)) throw error;
    const body = { message: error.message, code: error.code };
    switch (error.code) {
      case "CONNECTION_NOT_FOUND":
      case "LINK_NOT_FOUND":
      case "SUBSCRIPTION_NOT_FOUND":
      case "TARGET_NOT_FOUND":
        throw new NotFoundException(body);
      case "CONNECTION_EXISTS":
      case "CONNECTION_DISABLED":
        throw new ConflictException(body);
      case "ENCRYPTION_KEY_MISSING":
        throw new ServiceUnavailableException(body);
      case "CONNECTION_TEST_FAILED":
        throw new UnprocessableEntityException(body);
      case "PLATFORM_ERROR":
        throw new BadGatewayException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

// Admin settings for chat bots (docs/BOTS-INTEGRATION-PLAN.md §8). Secrets are write-only: no
// response ever contains a token, only "set" + its last 4 characters.
@Controller("v1/bots")
export class BotsController {
  constructor(private readonly connections: BotConnectionService) {}

  @Get("providers")
  @RequirePermission("bot_connection", "read")
  providers() {
    return this.connections.providers();
  }

  @Get("connections")
  @RequirePermission("bot_connection", "read")
  overview(@CurrentUser() actor: CurrentUserPayload) {
    return this.connections.overview(actor.companyId);
  }

  @Get("connections/:id")
  @RequirePermission("bot_connection", "read")
  get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapBotErrors(this.connections.get(actor.companyId, id));
  }

  @Post("connections/test")
  @HttpCode(200)
  @RequirePermission("bot_connection", "manage")
  test(@Body() dto: TestConnectionDto) {
    return mapBotErrors(this.connections.test(dto.provider, dto.credentials));
  }

  @Post("connections")
  @RequirePermission("bot_connection", "manage")
  create(@Body() dto: CreateConnectionDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.create(dto, actor, correlationId));
  }

  @Patch("connections/:id")
  @RequirePermission("bot_connection", "manage")
  update(@Param("id") id: string, @Body() dto: UpdateConnectionDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.update(id, dto, actor, correlationId));
  }

  @Post("connections/:id/install")
  @HttpCode(200)
  @RequirePermission("bot_connection", "manage")
  reinstall(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.reinstall(id, actor, correlationId));
  }

  @Post("connections/:id/enable")
  @HttpCode(200)
  @RequirePermission("bot_connection", "manage")
  enable(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.setStatus(id, "ACTIVE", actor, correlationId));
  }

  @Post("connections/:id/disable")
  @HttpCode(200)
  @RequirePermission("bot_connection", "manage")
  disable(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.setStatus(id, "DISABLED", actor, correlationId));
  }

  @Delete("connections/:id")
  @HttpCode(204)
  @RequirePermission("bot_connection", "manage")
  async remove(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.connections.remove(id, actor, correlationId));
  }

  @Get("connections/:id/links")
  @RequirePermission("bot_connection", "read")
  links(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapBotErrors(this.connections.links(actor.companyId, id));
  }

  @Delete("connections/:id/links/:linkId")
  @HttpCode(204)
  @RequirePermission("bot_connection", "manage")
  async revokeLink(@Param("id") id: string, @Param("linkId") linkId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.connections.revokeLink(id, linkId, actor, correlationId));
  }

  @Get("connections/:id/deliveries")
  @RequirePermission("bot_connection", "read")
  deliveries(@Param("id") id: string, @Query() query: DeliveriesQueryDto, @CurrentUser() actor: CurrentUserPayload) {
    return mapBotErrors(this.connections.deliveries(actor.companyId, id, query.limit ?? 50));
  }

  @Get("connections/:id/targets")
  @RequirePermission("bot_connection", "read")
  targets(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapBotErrors(this.connections.targets(actor.companyId, id));
  }

  @Post("connections/:id/targets")
  @RequirePermission("bot_connection", "manage")
  addTarget(@Param("id") id: string, @Body() dto: AddTargetDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(this.connections.addTarget(id, dto, actor, correlationId));
  }

  @Delete("connections/:id/targets/:targetId")
  @HttpCode(204)
  @RequirePermission("bot_connection", "manage")
  async removeTarget(@Param("id") id: string, @Param("targetId") targetId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.connections.removeTarget(id, targetId, actor, correlationId));
  }

  @Post("connections/:id/targets/:targetId/subscriptions")
  @RequirePermission("bot_connection", "manage")
  addTargetSubscription(
    @Param("id") id: string,
    @Param("targetId") targetId: string,
    @Body() dto: SubscriptionDto,
    @CurrentUser() actor: CurrentUserPayload,
    @CorrelationId() correlationId: string,
  ) {
    return mapBotErrors(
      this.connections.addTargetSubscription(id, targetId, { reportType: dto.reportType, sendTime: dto.sendTime, weekday: dto.weekday ?? null, language: dto.language, attachPdf: dto.attachPdf ?? false }, actor, correlationId),
    );
  }

  @Delete("connections/:id/subscriptions/:subscriptionId")
  @HttpCode(204)
  @RequirePermission("bot_connection", "manage")
  async removeTargetSubscription(@Param("id") id: string, @Param("subscriptionId") subscriptionId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.connections.removeTargetSubscription(id, subscriptionId, actor, correlationId));
  }
}

// The signed-in user's own chat accounts, preferences and report subscriptions. Any user may link
// their own account; what the bot then shows them is limited by their ordinary permissions.
@Controller("v1/bots/me")
export class BotMeController {
  constructor(private readonly links: BotLinkService) {}

  @Get()
  @AuthenticatedOnly()
  mine(@CurrentUser() actor: CurrentUserPayload) {
    return this.links.myLinks(actor);
  }

  @Post("link-codes")
  @AuthenticatedOnly()
  createCode(@Body() dto: LinkCodeDto, @CurrentUser() actor: CurrentUserPayload) {
    return mapBotErrors(this.links.createCode(dto.connectionId, dto.language, actor));
  }

  @Delete("links/:linkId")
  @HttpCode(204)
  @AuthenticatedOnly()
  async unlink(@Param("linkId") linkId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.links.unlinkMine(linkId, actor, correlationId));
  }

  @Put("links/:linkId/preferences")
  @HttpCode(204)
  @AuthenticatedOnly()
  async preferences(@Param("linkId") linkId: string, @Body() dto: PreferencesDto, @CurrentUser() actor: CurrentUserPayload): Promise<void> {
    await mapBotErrors(this.links.updatePreferences(linkId, dto, actor));
  }

  @Post("subscriptions")
  @AuthenticatedOnly()
  subscribe(@Body() dto: MySubscriptionDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapBotErrors(
      this.links.subscribe(dto.connectionId, { reportType: dto.reportType, sendTime: dto.sendTime, weekday: dto.weekday ?? null, attachPdf: dto.attachPdf ?? false, language: dto.language }, actor, correlationId),
    );
  }

  @Delete("subscriptions/:subscriptionId")
  @HttpCode(204)
  @AuthenticatedOnly()
  async unsubscribe(@Param("subscriptionId") subscriptionId: string, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string): Promise<void> {
    await mapBotErrors(this.links.unsubscribe(subscriptionId, actor, correlationId));
  }
}
