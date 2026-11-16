import { Controller, HttpCode, NotFoundException, Param, Post, Req, UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { isProviderId } from "@erp/bots";
import { newId } from "@erp/shared";
import { Public } from "../../auth/public.decorator.js";
import { BotInboundQueue } from "../bots-runtime.host.js";
import { BotRuntime } from "../application/bot-runtime.js";

// Where Telegram and Discord deliver updates (docs/BOTS-INTEGRATION-PLAN.md §6.2). Public — the
// platform authenticates each request instead (Telegram secret header, Discord Ed25519 signature),
// checked against the connection's own secrets before anything else happens. The real work is
// queued: Discord expects an answer within 3 seconds.
@Controller("v1/bots/webhooks")
export class BotWebhooksController {
  constructor(
    private readonly runtime: BotRuntime,
    private readonly inbound: BotInboundQueue,
  ) {}

  @Post(":provider/:connectionId")
  @Public()
  @HttpCode(200)
  async receive(@Param("provider") provider: string, @Param("connectionId") connectionId: string, @Req() request: RawBodyRequest<Request>): Promise<unknown> {
    // Unknown provider / connection → 404 with no hint about which part was wrong.
    if (!isProviderId(provider) || !/^[0-9a-f-]{36}$/i.test(connectionId)) throw new NotFoundException();
    const found = await this.runtime.webhookSecrets(connectionId, provider);
    if (!found) throw new NotFoundException();
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    const parsed = found.adapter.parseWebhook({ headers, rawBody: request.rawBody ?? Buffer.alloc(0) }, found.secrets);
    if (parsed.status === "rejected") throw new UnauthorizedException();
    if (parsed.status === "handshake") return parsed.response;
    if (parsed.status === "ignored" || !found.active) return {};

    const event = parsed.event;
    let form: { actionId: string; spec: NonNullable<Awaited<ReturnType<BotRuntime["formForAction"]>>> } | undefined;
    // Platforms with pop-up forms need the form in this very response.
    if (event.kind === "action" && found.adapter.capabilities.modals) {
      const spec = await this.runtime.formForAction(connectionId, event.actionId, event.sender.id);
      if (spec) form = { actionId: event.actionId, spec };
    }
    if (!form) await this.inbound.add(connectionId, event, `bot:${newId()}`);
    return found.adapter.immediateResponse(event, form);
  }
}
