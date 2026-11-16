import type { PrismaClient } from "@erp/db";
import { Prisma } from "@erp/db";
import {
  AdapterError,
  type Action,
  type ActionRow,
  type BotMessage,
  type ChannelAdapter,
  type ConnectionSecrets,
  type FormSpec,
  type InboundEvent,
  type OutboundFile,
} from "@erp/bots";
import type { IAuditLogger, IPermissionService } from "@erp/core";
import { newId } from "@erp/shared";
import { getBotTranslator } from "../../i18n/server-i18n.js";
import type { BotsConfig } from "../bots.config.js";
import { AdapterRegistry, BotVault, asLanguage, randomToken, type BotLanguage } from "./bot-core.js";
import type { BotContext, BotFeature, BotUserContext, ConnectionInfo, FeatureMessage, Intent, LinkedUser } from "./bot-context.js";
import { BotFormatter } from "./bot-format.js";
import type { BotFeatureKey } from "./bot-connection.service.js";

// An expected, user-facing refusal ("you may not approve this", "nothing found"). Rendered as a
// friendly card in the user's language; never logged as an error.
export class BotNotice extends Error {
  constructor(
    readonly key: string,
    readonly params: Readonly<Record<string, string>> = {},
    readonly tone: "warning" | "danger" | "info" = "warning",
  ) {
    super(key);
    this.name = "BotNotice";
  }
}

export interface BotLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

interface LoadedConnection {
  readonly info: ConnectionInfo;
  readonly adapter: ChannelAdapter;
  readonly secrets: ConnectionSecrets;
  readonly status: string;
}

const DEFAULT_TOKEN_TTL_HOURS = 72;
const SESSION_TTL_MS = 10 * 60 * 1000;
// Commands that work before an account is linked, and in group chats.
const OPEN_COMMANDS = new Set(["start", "link", "help", "chatid"]);
const GROUP_COMMANDS = new Set(["chatid", "help"]);

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function asRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

function parseIntent(value: unknown): Intent | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v["f"] !== "string" || typeof v["a"] !== "string") return null;
  return {
    f: v["f"],
    a: v["a"],
    p: asRecord(v["p"]),
    ...(v["once"] === true ? { once: true } : {}),
    ...(typeof v["form"] === "string" ? { form: v["form"] } : {}),
  };
}

export class BotRuntime {
  private readonly features: ReadonlyMap<string, BotFeature>;
  private readonly commands: ReadonlyMap<string, BotFeature>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions: IPermissionService,
    private readonly audit: IAuditLogger,
    private readonly registry: AdapterRegistry,
    private readonly vault: BotVault,
    private readonly config: BotsConfig,
    private readonly logger: BotLogger,
    features: ReadonlyArray<BotFeature>,
  ) {
    this.features = new Map(features.map((f) => [f.key, f]));
    const commands = new Map<string, BotFeature>();
    for (const feature of features) for (const name of Object.keys(feature.commands ?? {})) commands.set(name, feature);
    this.commands = commands;
  }

  can(userId: string, action: string, resource: string): Promise<boolean> {
    return this.permissions.can(userId, action, resource);
  }

  // ── connection + identity ─────────────────────────────────────────────────────────────────

  async loadConnection(connectionId: string): Promise<LoadedConnection | null> {
    const row = await this.prisma.botConnection.findUnique({
      where: { id: connectionId },
      include: { company: { select: { name: true, nameAr: true, timezone: true, defaultCurrency: true } } },
    });
    if (!row) return null;
    const publicConfig = asRecord(row.publicConfig);
    return {
      status: row.status,
      adapter: this.registry.get(row.provider),
      secrets: { ...this.vault.open(row.credentialsCiphertext), ...publicConfig },
      info: {
        id: row.id,
        companyId: row.companyId,
        provider: row.provider,
        enabledFeatures: row.enabledFeatures,
        approvalCeiling: row.approvalCeiling?.toFixed(4) ?? null,
        timezone: row.company.timezone,
        currency: row.company.defaultCurrency,
        companyName: row.company.name,
      },
    };
  }

  // Secrets for a webhook check; null when the connection is gone (→ 404, never a hint why).
  async webhookSecrets(connectionId: string, provider: string): Promise<{ adapter: ChannelAdapter; secrets: ConnectionSecrets; active: boolean } | null> {
    const row = await this.prisma.botConnection.findUnique({ where: { id: connectionId }, select: { provider: true, status: true, credentialsCiphertext: true, publicConfig: true } });
    if (!row || row.provider !== provider) return null;
    return { adapter: this.registry.get(row.provider), secrets: { ...this.vault.open(row.credentialsCiphertext), ...asRecord(row.publicConfig) }, active: row.status === "ACTIVE" };
  }

  private async resolveLink(connectionId: string, externalUserId: string): Promise<LinkedUser | null> {
    const link = await this.prisma.botIdentityLink.findFirst({
      where: { connectionId, externalUserId, revokedAt: null },
      include: { user: { select: { isActive: true } } },
    });
    if (!link) return null;
    if (!link.user.isActive) {
      // A deactivated ERP user loses chat access at once (docs/BOTS-INTEGRATION-PLAN.md §6.3).
      await this.prisma.botIdentityLink.update({ where: { id: link.id }, data: { revokedAt: new Date(), revokedReason: "user_inactive" } });
      return null;
    }
    return this.toLinked(link);
  }

  private toLinked(link: { id: string; userId: string; language: string; privateChatId: string; quietHoursStart: string | null; quietHoursEnd: string | null; disabledAlerts: string[] }): LinkedUser {
    return {
      linkId: link.id,
      userId: link.userId,
      language: asLanguage(link.language),
      privateChatId: link.privateChatId,
      quietHoursStart: link.quietHoursStart,
      quietHoursEnd: link.quietHoursEnd,
      disabledAlerts: link.disabledAlerts,
    };
  }

  async userContext(info: ConnectionInfo, user: LinkedUser, correlationId: string): Promise<BotUserContext> {
    const t = await getBotTranslator(user.language);
    const enabled = new Set(info.enabledFeatures);
    return {
      connection: info,
      user,
      language: user.language,
      t,
      fmt: new BotFormatter(user.language, info.timezone),
      correlationId,
      can: (action, resource) => this.permissions.can(user.userId, action, resource),
      webUrl: (path) => (this.config.webAppUrl ? `${this.config.webAppUrl}${path}` : null),
      featureEnabled: (feature: BotFeatureKey) => enabled.has(feature),
    };
  }

  // ── tokens ────────────────────────────────────────────────────────────────────────────────

  // Replaces every Intent in the tree with a stored short token bound to this user.
  async materialize(message: FeatureMessage, info: ConnectionInfo, userId: string | null): Promise<BotMessage> {
    const rows: Prisma.BotActionTokenCreateManyInput[] = [];
    const mint = (intent: Intent): string => {
      const id = randomToken(16);
      rows.push({
        id,
        companyId: info.companyId,
        connectionId: info.id,
        userId,
        intent: { f: intent.f, a: intent.a, p: intent.p ?? {}, ...(intent.once ? { once: true } : {}), ...(intent.form ? { form: intent.form } : {}) },
        singleUse: intent.once === true,
        expiresAt: new Date(Date.now() + (intent.ttlHours ?? DEFAULT_TOKEN_TTL_HOURS) * 3600_000),
      });
      return id;
    };
    const mapAction = (action: Action<Intent>): Action<string> => {
      if (action.type === "button") return { ...action, action: mint(action.action) };
      if (action.type === "link") return action;
      return { ...action, options: action.options.map((o) => ({ ...o, action: mint(o.action) })) };
    };
    const actions: ActionRow<string>[] = (message.actions ?? []).map((row) => ({ items: row.items.map(mapAction) }));
    if (rows.length > 0) await this.prisma.botActionToken.createMany({ data: rows });
    const { actions: _drop, ...rest } = message;
    void _drop;
    return actions.length > 0 ? { ...rest, actions } : rest;
  }

  // For Discord: the modal must be returned in the webhook response itself.
  async formForAction(connectionId: string, tokenId: string, externalUserId: string): Promise<FormSpec | null> {
    const token = await this.prisma.botActionToken.findFirst({ where: { id: tokenId, connectionId, usedAt: null, expiresAt: { gt: new Date() } } });
    const intent = parseIntent(token?.intent);
    if (!token || !intent?.form) return null;
    const loaded = await this.loadConnection(connectionId);
    const link = await this.resolveLink(connectionId, externalUserId);
    if (!loaded || !link || link.userId !== token.userId) return null;
    const builder = this.features.get(intent.f)?.forms?.[intent.form];
    if (!builder) return null;
    return builder(await this.userContext(loaded.info, link, `bot:${tokenId}`));
  }

  // ── inbound ───────────────────────────────────────────────────────────────────────────────

  async handleInbound(connectionId: string, event: InboundEvent, correlationId: string): Promise<void> {
    const loaded = await this.loadConnection(connectionId);
    if (!loaded || loaded.status !== "ACTIVE") return;
    try {
      await this.prisma.botInboundEvent.create({ data: { connectionId, eventId: event.eventId } });
    } catch (error) {
      if (isUniqueViolation(error)) return; // the platform retried a delivery we already handled
      throw error;
    }
    const { adapter, secrets, info } = loaded;
    const link = await this.resolveLink(connectionId, event.sender.id);
    const language: BotLanguage = link?.language ?? (event.sender.locale?.toLowerCase().startsWith("ar") ? "ar" : "en");
    const user: LinkedUser = link ?? {
      linkId: "",
      userId: "",
      language,
      privateChatId: event.chat.chatId,
      quietHoursStart: null,
      quietHoursEnd: null,
      disabledAlerts: [],
    };
    const base = await this.userContext(info, user, correlationId);
    let acknowledged = false;
    const ack = async (notice?: string): Promise<void> => {
      if (acknowledged) return;
      acknowledged = true;
      await adapter.acknowledge(event, secrets, notice).catch(() => undefined);
    };
    let lastReply: { chatId: string; messageId: string } | null = null;
    const ctx: BotContext = {
      ...base,
      event,
      adapter,
      secrets,
      reply: async (message, mode = "replace") => {
        await ack();
        const rendered = await this.materialize(message, info, link?.userId ?? null);
        const ref = await adapter.reply(event, rendered, secrets, mode);
        // Discord interaction refs expire after 15 minutes; only plain message ids are kept.
        lastReply = ref.interactionToken ? null : { chatId: ref.chatId, messageId: ref.messageId };
      },
      replyFile: async (file, caption) => {
        await ack();
        await adapter.showActivity(event.chat, "uploading", secrets).catch(() => undefined);
        const renderedCaption = caption ? await this.materialize(caption, info, link?.userId ?? null) : null;
        await adapter.replyFile(event, file, renderedCaption, secrets);
      },
      toast: async (text) => ack(text),
      trackLastReply: async (subjectType, subjectId) => {
        if (!lastReply) return;
        await this.prisma.botSentMessage.create({
          data: { id: newId(), companyId: info.companyId, connectionId, chatId: lastReply.chatId, messageId: lastReply.messageId, subjectType, subjectId },
        });
      },
    };

    try {
      await this.dispatch(ctx, link);
    } catch (error) {
      await this.replyWithError(ctx, error);
    } finally {
      await ack();
    }
  }

  private async dispatch(ctx: BotContext, link: LinkedUser | null): Promise<void> {
    const { event } = ctx;
    // Group chats see almost nothing: a Telegram group reply is visible to everyone. Discord
    // server channels are fine — interaction replies there are private to the asking user.
    const privateReply = event.chat.isPrivate || event.interactionToken !== undefined;

    if (event.kind === "command") {
      if (!privateReply && !GROUP_COMMANDS.has(event.name)) throw new BotNotice("errors.privateOnly", {}, "info");
      const feature = this.commands.get(event.name === "start" ? "start" : event.name);
      if (!feature) throw new BotNotice("errors.unknownCommand", {}, "info");
      if (!link && !OPEN_COMMANDS.has(event.name)) throw new BotNotice("errors.notLinked", {}, "info");
      this.assertEnabled(ctx, feature);
      await feature.commands?.[event.name]?.(ctx, event.args);
      return;
    }
    if (!privateReply) return; // ignore chatter in groups
    if (!link) throw new BotNotice("errors.notLinked", {}, "info");

    if (event.kind === "action" || event.kind === "form") {
      await this.runToken(ctx, link, event.actionId, event.kind === "form" ? event.fields : null);
      return;
    }
    if (event.kind === "text") {
      const session = await this.prisma.botChatSession.findUnique({ where: { connectionId_chatId_userId: { connectionId: ctx.connection.id, chatId: event.chat.chatId, userId: link.userId } } });
      if (session && session.expiresAt > new Date()) {
        await this.prisma.botChatSession.delete({ where: { id: session.id } });
        const awaiting = asRecord(session.awaiting);
        const tokenId = awaiting["tokenId"];
        const fieldKey = awaiting["fieldKey"];
        if (tokenId && fieldKey) {
          await this.runToken(ctx, link, tokenId, { [fieldKey]: event.text });
          return;
        }
      }
      throw new BotNotice("errors.useMenu", {}, "info");
    }
    if (event.kind === "file") {
      const feature = [...this.features.values()].find((f) => f.onFile);
      if (!feature?.onFile) throw new BotNotice("errors.filesNotSupported", {}, "info");
      this.assertEnabled(ctx, feature);
      await feature.onFile(ctx);
    }
  }

  private assertEnabled(ctx: BotContext, feature: BotFeature): void {
    if (feature.toggle && !ctx.featureEnabled(feature.toggle)) throw new BotNotice("errors.featureDisabled", {}, "info");
  }

  private async runToken(ctx: BotContext, link: LinkedUser, tokenId: string, fields: Readonly<Record<string, string>> | null): Promise<void> {
    const token = await this.prisma.botActionToken.findFirst({ where: { id: tokenId, connectionId: ctx.connection.id } });
    const intent = parseIntent(token?.intent);
    if (!token || !intent) throw new BotNotice("errors.expired", {}, "info");
    if (token.userId !== link.userId) throw new BotNotice("errors.notForYou");
    if (token.expiresAt <= new Date()) throw new BotNotice("errors.expired", {}, "info");
    if (token.usedAt) throw new BotNotice("errors.alreadyUsed", {}, "info");
    const feature = this.features.get(intent.f);
    const handler = feature?.actions?.[intent.a];
    if (!feature || !handler) throw new BotNotice("errors.expired", {}, "info");
    this.assertEnabled(ctx, feature);

    // An action behind a form: ask first (Telegram — Discord already showed a modal).
    if (intent.form && fields === null) {
      const spec = feature.forms?.[intent.form]?.(ctx);
      const field = spec?.fields[0];
      if (!spec || !field) throw new BotNotice("errors.expired", {}, "info");
      await this.prisma.botChatSession.upsert({
        where: { connectionId_chatId_userId: { connectionId: ctx.connection.id, chatId: ctx.event.chat.chatId, userId: link.userId } },
        create: { id: newId(), connectionId: ctx.connection.id, chatId: ctx.event.chat.chatId, userId: link.userId, awaiting: { tokenId, fieldKey: field.key }, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
        update: { awaiting: { tokenId, fieldKey: field.key }, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      await ctx.toast(spec.title);
      await ctx.adapter.sendPrompt(ctx.event.chat, `${spec.title}\n${field.label}`, ctx.secrets);
      return;
    }
    if (token.singleUse) {
      // Atomic claim: a double tap runs the action once.
      const claimed = await this.prisma.botActionToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count === 0) throw new BotNotice("errors.alreadyUsed", {}, "info");
    }
    await handler(ctx, intent.p ?? {}, fields ?? {});
  }

  private async replyWithError(ctx: BotContext, error: unknown): Promise<void> {
    let message: FeatureMessage;
    if (error instanceof BotNotice) {
      message = {
        direction: ctx.language === "ar" ? "rtl" : "ltr",
        blocks: [{ type: "header", tone: error.tone, icon: error.tone === "info" ? "menu" : "alert", title: ctx.t(error.key, error.params) }],
        actions: error.key === "errors.notLinked" ? [] : [{ items: [{ type: "button", style: "secondary", label: ctx.t("menu.backToMenu"), icon: "menu", action: { f: "menu", a: "open" } }] }],
      };
    } else {
      this.logger.error(
        { connectionId: ctx.connection.id, correlationId: ctx.correlationId, kind: ctx.event.kind, err: error instanceof Error ? error.message : String(error) },
        "bot.inbound_failed",
      );
      message = {
        direction: ctx.language === "ar" ? "rtl" : "ltr",
        blocks: [
          { type: "header", tone: "danger", icon: "alert", title: ctx.t("errors.generic") },
          { type: "footer", text: ctx.t("errors.reference", { id: ctx.correlationId }) },
        ],
      };
    }
    try {
      // Unlinked users have no token owner: the error card carries no buttons that need one.
      const linked = ctx.user.userId !== "";
      const rendered = linked ? await this.materialize(message, ctx.connection, ctx.user.userId) : { ...message, actions: [] };
      await ctx.adapter.reply(ctx.event, rendered, ctx.secrets, "new");
    } catch (sendError) {
      this.logger.warn({ connectionId: ctx.connection.id, err: sendError instanceof Error ? sendError.message : String(sendError) }, "bot.error_reply_failed");
    }
  }

  // ── outbound (alerts, reports, approval updates) ─────────────────────────────────────────

  // Sends a message to one linked user's private chat. Returns false when the user cannot be
  // reached (blocked the bot, left the server) — the link is then marked unreachable.
  async sendToUser(
    connectionId: string,
    userId: string,
    kind: string,
    build: (ctx: BotUserContext) => Promise<{ message: FeatureMessage; file?: OutboundFile } | null>,
    track?: { readonly subjectType: string; readonly subjectId: string },
  ): Promise<"sent" | "skipped" | "failed"> {
    const loaded = await this.loadConnection(connectionId);
    if (!loaded || loaded.status !== "ACTIVE") return "skipped";
    const link = await this.prisma.botIdentityLink.findFirst({ where: { connectionId, userId, revokedAt: null }, include: { user: { select: { isActive: true } } } });
    if (!link || !link.user.isActive) return "skipped";
    const ctx = await this.userContext(loaded.info, this.toLinked(link), `bot:${kind}:${newId()}`);
    const built = await build(ctx);
    if (!built) return "skipped";
    const target = { chatId: link.privateChatId, isPrivate: true };
    try {
      const rendered = await this.materialize(built.message, loaded.info, userId);
      const ref = built.file
        ? await loaded.adapter.sendFile(target, built.file, rendered, loaded.secrets)
        : await loaded.adapter.send(target, rendered, loaded.secrets);
      if (track) {
        await this.prisma.botSentMessage.create({
          data: { id: newId(), companyId: loaded.info.companyId, connectionId, chatId: ref.chatId, messageId: ref.messageId, subjectType: track.subjectType, subjectId: track.subjectId },
        });
      }
      if (link.unreachableAt) await this.prisma.botIdentityLink.update({ where: { id: link.id }, data: { unreachableAt: null } });
      await this.logDelivery(loaded.info, userId, link.privateChatId, kind, "SENT", null);
      return "sent";
    } catch (error) {
      const code = error instanceof AdapterError ? error.code : "INTERNAL";
      if (code === "BLOCKED") await this.prisma.botIdentityLink.update({ where: { id: link.id }, data: { unreachableAt: new Date() } });
      await this.logDelivery(loaded.info, userId, link.privateChatId, kind, "FAILED", code);
      if (error instanceof AdapterError && error.retryable) throw error; // let the job retry
      this.logger.warn({ connectionId, kind, code }, "bot.delivery_failed");
      return "failed";
    }
  }

  // A broadcast target (group / channel): no user, so no buttons that need an owner.
  async sendToChat(connectionId: string, chatId: string, language: BotLanguage, kind: string, build: (ctx: BotUserContext) => Promise<{ message: FeatureMessage; file?: OutboundFile } | null>): Promise<void> {
    const loaded = await this.loadConnection(connectionId);
    if (!loaded || loaded.status !== "ACTIVE") return;
    const pseudo: LinkedUser = { linkId: "", userId: "", language, privateChatId: chatId, quietHoursStart: null, quietHoursEnd: null, disabledAlerts: [] };
    const ctx = await this.userContext(loaded.info, pseudo, `bot:${kind}:${newId()}`);
    const built = await build(ctx);
    if (!built) return;
    const message: BotMessage = { ...built.message, actions: (built.message.actions ?? []).map((row) => ({ items: row.items.filter((a): a is Extract<Action<Intent>, { type: "link" }> => a.type === "link") })).filter((r) => r.items.length > 0) };
    const target = { chatId, isPrivate: false };
    try {
      if (built.file) await loaded.adapter.sendFile(target, built.file, message, loaded.secrets);
      else await loaded.adapter.send(target, message, loaded.secrets);
      await this.logDelivery(loaded.info, null, chatId, kind, "SENT", null);
    } catch (error) {
      await this.logDelivery(loaded.info, null, chatId, kind, "FAILED", error instanceof AdapterError ? error.code : "INTERNAL");
      if (error instanceof AdapterError && error.retryable) throw error;
    }
  }

  // Updates every delivered copy of a message about a record (e.g. after an approval decision).
  async updateTracked(companyId: string, subjectType: string, subjectId: string, build: (ctx: BotUserContext) => Promise<FeatureMessage>): Promise<void> {
    const sent = await this.prisma.botSentMessage.findMany({ where: { companyId, subjectType, subjectId } });
    for (const copy of sent) {
      const loaded = await this.loadConnection(copy.connectionId);
      if (!loaded) continue;
      const link = await this.prisma.botIdentityLink.findFirst({ where: { connectionId: copy.connectionId, privateChatId: copy.chatId, revokedAt: null } });
      const user: LinkedUser = link ? this.toLinked(link) : { linkId: "", userId: "", language: "en", privateChatId: copy.chatId, quietHoursStart: null, quietHoursEnd: null, disabledAlerts: [] };
      const ctx = await this.userContext(loaded.info, user, `bot:update:${subjectId}`);
      try {
        const rendered = await this.materialize(await build(ctx), loaded.info, user.userId || null);
        await loaded.adapter.edit({ chatId: copy.chatId, messageId: copy.messageId }, rendered, loaded.secrets);
      } catch (error) {
        this.logger.warn({ connectionId: copy.connectionId, subjectType, err: error instanceof Error ? error.message : String(error) }, "bot.tracked_update_failed");
      }
    }
    await this.prisma.botSentMessage.deleteMany({ where: { companyId, subjectType, subjectId } });
  }

  private async logDelivery(info: ConnectionInfo, userId: string | null, chatId: string | null, kind: string, status: string, errorCode: string | null): Promise<void> {
    await this.prisma.botDeliveryLog.create({ data: { id: newId(), companyId: info.companyId, connectionId: info.id, userId, chatId, kind, status, errorCode } });
  }

  async auditBotAction(ctx: BotUserContext, action: string, entityType: string, entityId: string, after: Record<string, unknown>): Promise<void> {
    await this.audit.log({ actorId: ctx.user.userId, action, entityType, entityId, after: { ...after, channel: ctx.connection.provider }, correlationId: ctx.correlationId });
  }
}
