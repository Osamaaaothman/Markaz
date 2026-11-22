import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Decision } from "@erp/ai";
import type { Request, Response } from "express";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator.js";
import { CorrelationId } from "../common/correlation-id.decorator.js";
import { RequirePermission } from "../identity/require-permission.decorator.js";
import { AiChatError, AiChatService, type ChatEvent } from "./ai-chat.service.js";
import { AiSettingsError, AiSettingsService } from "./ai-settings.service.js";
import { AiSettingsDto, DecideDto, SendMessageDto, UpdateConversationDto } from "./ai.dtos.js";

export async function mapAiErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw toHttp(error);
  }
}

function toHttp(error: unknown): unknown {
  if (error instanceof AiChatError || error instanceof AiSettingsError) {
    const body = { message: error.message, code: error.code };
    switch (error.code) {
      case "FORBIDDEN": return new ForbiddenException(body);
      case "CONVERSATION_NOT_FOUND": return new NotFoundException(body);
      case "NOTHING_TO_DECIDE":
      case "VERSION_CONFLICT": return new ConflictException(body);
      case "LIMIT_REACHED":
      case "AUTO_MODE_OFF":
      case "DISABLED":
      case "NOT_CONFIGURED": return new UnprocessableEntityException(body);
      case "ENCRYPTION_KEY_MISSING": return new ServiceUnavailableException(body);
      default: return new BadRequestException(body);
    }
  }
  return error;
}

// Server-Sent Events over a POST response: the browser reads it with fetch() + a stream reader.
// Errors before the stream starts are normal HTTP errors; errors after it starts are an "error" event.
async function stream(req: Request, res: Response, work: (emit: (e: ChatEvent) => void, signal: AbortSignal) => Promise<void>): Promise<void> {
  const abort = new AbortController();
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // nginx (docker/web.nginx.conf) must not buffer the stream.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  };
  // "close" on the response fires when the client goes away before we finished.
  res.on("close", () => { if (!res.writableEnded) abort.abort(); });
  const emit = (e: ChatEvent): void => {
    start();
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  void req;
  try {
    await work(emit, abort.signal);
    start();
    res.end();
  } catch (error) {
    if (!started) {
      const http = toHttp(error);
      const status = http instanceof Error && "getStatus" in http && typeof http.getStatus === "function" ? (http.getStatus as () => number)() : 500;
      const body = http instanceof Error && "getResponse" in http && typeof http.getResponse === "function" ? (http.getResponse as () => unknown)() : { code: "INTERNAL" };
      res.status(status).json(body);
      return;
    }
    emit({ type: "error", code: error instanceof AiChatError || error instanceof AiSettingsError ? error.code : "INTERNAL" });
    res.end();
  }
}

@Controller("v1/ai")
export class AiController {
  constructor(
    private readonly chat: AiChatService,
    private readonly settings: AiSettingsService,
  ) {}

  // ─── Chat ───
  @Post("messages")
  @RequirePermission("ai_assistant", "use")
  async send(@Body() dto: SendMessageDto, @CurrentUser() actor: CurrentUserPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    await stream(req, res, (emit, signal) =>
      this.chat.send(actor, { text: dto.text, mode: dto.mode, locale: dto.locale, conversationId: dto.conversationId, page: dto.page }, emit, signal),
    );
  }

  @Post("conversations/:id/decisions")
  @RequirePermission("ai_assistant", "interact")
  async decide(@Param("id") id: string, @Body() dto: DecideDto, @CurrentUser() actor: CurrentUserPayload, @Req() req: Request, @Res() res: Response): Promise<void> {
    const decisions: Record<string, Decision> = {};
    for (const [key, value] of Object.entries(dto.decisions)) {
      if (!/^c\d{1,4}$/.test(key) || (value !== "approve" && value !== "reject")) throw new BadRequestException({ code: "INVALID_DECISION" });
      decisions[key] = value;
    }
    await stream(req, res, (emit, signal) => this.chat.decide(actor, { conversationId: id, decisions, edits: dto.edits, locale: dto.locale }, emit, signal));
  }

  @Get("conversations")
  @RequirePermission("ai_assistant", "use")
  list(@CurrentUser() actor: CurrentUserPayload) {
    return this.chat.list(actor);
  }

  @Get("conversations/:id")
  @RequirePermission("ai_assistant", "use")
  get(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapAiErrors(this.chat.get(actor, id));
  }

  @Patch("conversations/:id")
  @RequirePermission("ai_assistant", "use")
  @HttpCode(204)
  update(@Param("id") id: string, @Body() dto: UpdateConversationDto, @CurrentUser() actor: CurrentUserPayload) {
    return mapAiErrors(this.chat.update(actor, id, dto));
  }

  @Delete("conversations/:id")
  @RequirePermission("ai_assistant", "use")
  @HttpCode(204)
  remove(@Param("id") id: string, @CurrentUser() actor: CurrentUserPayload) {
    return mapAiErrors(this.chat.remove(actor, id));
  }

  // What the current user may do — the UI shows only the modes that will work.
  @Get("me")
  @RequirePermission("ai_assistant", "use")
  async me(@CurrentUser() actor: CurrentUserPayload) {
    const view = await this.settings.view(actor.companyId);
    const usage = await this.chat.monthUsage(actor.companyId, actor.id);
    return { configured: view.source !== "none" && view.enabled, autoModeEnabled: view.autoModeEnabled, provider: view.provider, model: view.model, usage };
  }

  // ─── Settings (admin) ───
  @Get("settings")
  @RequirePermission("ai_settings", "manage")
  async getSettings(@CurrentUser() actor: CurrentUserPayload) {
    const [view, company] = await Promise.all([this.settings.view(actor.companyId), this.chat.monthUsage(actor.companyId)]);
    return { ...view, usage: company };
  }

  @Put("settings")
  @RequirePermission("ai_settings", "manage")
  putSettings(@Body() dto: AiSettingsDto, @CurrentUser() actor: CurrentUserPayload, @CorrelationId() correlationId: string) {
    return mapAiErrors(this.settings.update(dto, actor, correlationId));
  }

  @Post("settings/test")
  @HttpCode(200)
  @RequirePermission("ai_settings", "manage")
  test(@Body() dto: AiSettingsDto, @CurrentUser() actor: CurrentUserPayload) {
    return mapAiErrors(this.settings.test(actor.companyId, dto));
  }
}
