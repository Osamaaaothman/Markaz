import { createHash } from "node:crypto";
import type { PrismaClient } from "@erp/db";
import { Prisma } from "@erp/db";
import type { IAuditLogger } from "@erp/core";
import { newId } from "@erp/shared";
import type { ExternalUser } from "@erp/bots";
import { BotError, asLanguage, randomToken, type BotLanguage } from "./bot-core.js";
import type { BotActor } from "./bot-connection.service.js";

const CODE_TTL_MS = 10 * 60 * 1000;

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export type LinkOutcome =
  | { readonly status: "linked"; readonly userId: string; readonly language: BotLanguage }
  | { readonly status: "invalid" }
  | { readonly status: "already_linked_other" };

// Account linking (docs/BOTS-INTEGRATION-PLAN.md §6.3): the signed-in web user asks for a one-time
// code, then hands it to the bot. Only the code hash is stored; a code works once, for 10 minutes.
export class BotLinkService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async createCode(connectionId: string, language: string, actor: BotActor) {
    const connection = await this.prisma.botConnection.findFirst({ where: { id: connectionId, companyId: actor.companyId } });
    if (!connection) throw new BotError("CONNECTION_NOT_FOUND", "Bot connection not found");
    if (connection.status !== "ACTIVE") throw new BotError("CONNECTION_DISABLED", "This bot is disabled");
    // Telegram deep-link payloads allow [A-Za-z0-9_-] up to 64 chars; 24 random bytes → 32 chars.
    const code = randomToken(24);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.prisma.botLinkCode.create({
      data: { id: newId(), companyId: actor.companyId, connectionId, userId: actor.id, codeHash: hashCode(code), language: asLanguage(language), expiresAt },
    });
    const identity = (connection.identity ?? {}) as { username?: string };
    const username = identity.username?.replace(/^@/, "") ?? null;
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      provider: connection.provider,
      deepLink: connection.provider === "telegram" && username ? `https://t.me/${username}?start=${code}` : null,
      command: connection.provider === "discord" ? `/link code:${code}` : `/start ${code}`,
    };
  }

  // Called from the chat. `privateChatId` is where direct messages to this person go.
  async consume(connectionId: string, code: string, sender: ExternalUser, privateChatId: string, correlationId: string): Promise<LinkOutcome> {
    const trimmed = code.trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(trimmed)) return { status: "invalid" };
    const now = new Date();
    const row = await this.prisma.botLinkCode.findUnique({ where: { codeHash: hashCode(trimmed) } });
    if (!row || row.connectionId !== connectionId || row.usedAt || row.expiresAt <= now) return { status: "invalid" };
    const user = await this.prisma.user.findFirst({ where: { id: row.userId, companyId: row.companyId, isActive: true }, select: { id: true } });
    if (!user) return { status: "invalid" };

    try {
      const linkId = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.botLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
        if (claimed.count === 0) return null;
        const otherUser = await tx.botIdentityLink.findFirst({ where: { connectionId, externalUserId: sender.id, revokedAt: null } });
        if (otherUser && otherUser.userId !== row.userId) return "other" as const;
        // Re-linking replaces this user's previous chat account.
        await tx.botIdentityLink.updateMany({ where: { connectionId, userId: row.userId, revokedAt: null }, data: { revokedAt: now, revokedReason: "relinked" } });
        const id = newId();
        await tx.botIdentityLink.create({
          data: {
            id,
            companyId: row.companyId,
            connectionId,
            userId: row.userId,
            externalUserId: sender.id,
            externalHandle: sender.handle ?? sender.displayName ?? null,
            privateChatId,
            language: row.language,
          },
        });
        return id;
      });
      if (linkId === null) return { status: "invalid" };
      if (linkId === "other") return { status: "already_linked_other" };
      await this.audit.log({
        actorId: row.userId,
        action: "bot_link.created",
        entityType: "BotIdentityLink",
        entityId: linkId,
        after: { connectionId, externalHandle: sender.handle ?? null },
        correlationId,
      });
      return { status: "linked", userId: row.userId, language: asLanguage(row.language) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "already_linked_other" };
      throw error;
    }
  }

  async unlinkFromChat(connectionId: string, externalUserId: string, correlationId: string): Promise<boolean> {
    const link = await this.prisma.botIdentityLink.findFirst({ where: { connectionId, externalUserId, revokedAt: null } });
    if (!link) return false;
    await this.prisma.botIdentityLink.update({ where: { id: link.id }, data: { revokedAt: new Date(), revokedBy: link.userId, revokedReason: "unlinked_in_chat" } });
    await this.audit.log({ actorId: link.userId, action: "bot_link.revoked", entityType: "BotIdentityLink", entityId: link.id, after: { by: "user", channel: "chat" }, correlationId });
    return true;
  }

  // ── the signed-in user's own view ─────────────────────────────────────────────────────────

  async myLinks(actor: BotActor) {
    const [connections, links, subscriptions] = await Promise.all([
      this.prisma.botConnection.findMany({ where: { companyId: actor.companyId, status: "ACTIVE" }, select: { id: true, provider: true, identity: true, enabledFeatures: true } }),
      this.prisma.botIdentityLink.findMany({ where: { companyId: actor.companyId, userId: actor.id, revokedAt: null } }),
      this.prisma.botSubscription.findMany({ where: { companyId: actor.companyId, userId: actor.id, disabledAt: null } }),
    ]);
    return connections.map((c) => {
      const link = links.find((l) => l.connectionId === c.id);
      return {
        connectionId: c.id,
        provider: c.provider,
        botUsername: ((c.identity ?? {}) as { username?: string }).username ?? null,
        enabledFeatures: c.enabledFeatures,
        link: link
          ? {
              id: link.id,
              externalHandle: link.externalHandle,
              language: link.language,
              linkedAt: link.linkedAt.toISOString(),
              unreachable: link.unreachableAt !== null,
              quietHoursStart: link.quietHoursStart,
              quietHoursEnd: link.quietHoursEnd,
              disabledAlerts: link.disabledAlerts,
            }
          : null,
        subscriptions: subscriptions
          .filter((s) => s.connectionId === c.id)
          .map((s) => ({ id: s.id, reportType: s.reportType, sendTime: s.sendTime, weekday: s.weekday, attachPdf: s.attachPdf, language: s.language })),
      };
    });
  }

  async unlinkMine(linkId: string, actor: BotActor, correlationId: string): Promise<void> {
    const link = await this.prisma.botIdentityLink.findFirst({ where: { id: linkId, userId: actor.id, companyId: actor.companyId, revokedAt: null } });
    if (!link) throw new BotError("LINK_NOT_FOUND", "Linked account not found");
    await this.prisma.botIdentityLink.update({ where: { id: link.id }, data: { revokedAt: new Date(), revokedBy: actor.id, revokedReason: "unlinked_by_user" } });
    await this.audit.log({ actorId: actor.id, action: "bot_link.revoked", entityType: "BotIdentityLink", entityId: link.id, after: { by: "user", channel: "web" }, correlationId });
  }

  async updatePreferences(
    linkId: string,
    input: { language?: string | undefined; quietHoursStart?: string | null | undefined; quietHoursEnd?: string | null | undefined; disabledAlerts?: ReadonlyArray<string> | undefined },
    actor: BotActor,
  ): Promise<void> {
    const link = await this.prisma.botIdentityLink.findFirst({ where: { id: linkId, userId: actor.id, companyId: actor.companyId, revokedAt: null } });
    if (!link) throw new BotError("LINK_NOT_FOUND", "Linked account not found");
    if ((input.quietHoursStart === null) !== (input.quietHoursEnd === null) && input.quietHoursStart !== undefined && input.quietHoursEnd !== undefined) {
      throw new BotError("INVALID_INPUT", "Quiet hours need both a start and an end");
    }
    await this.prisma.botIdentityLink.update({
      where: { id: link.id },
      data: {
        ...(input.language ? { language: asLanguage(input.language) } : {}),
        ...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
        ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
        ...(input.disabledAlerts ? { disabledAlerts: [...new Set(input.disabledAlerts)] } : {}),
      },
    });
  }

  async subscribe(
    connectionId: string,
    input: { reportType: string; sendTime: string; weekday: number | null; attachPdf: boolean; language: string },
    actor: BotActor,
    correlationId: string,
  ) {
    const link = await this.prisma.botIdentityLink.findFirst({ where: { connectionId, userId: actor.id, companyId: actor.companyId, revokedAt: null } });
    if (!link) throw new BotError("LINK_NOT_FOUND", "Link your chat account first");
    const id = newId();
    await this.prisma.botSubscription.create({
      data: { id, companyId: actor.companyId, connectionId, userId: actor.id, reportType: input.reportType, sendTime: input.sendTime, weekday: input.weekday, attachPdf: input.attachPdf, language: asLanguage(input.language), createdBy: actor.id },
    });
    await this.audit.log({ actorId: actor.id, action: "bot_subscription.created", entityType: "BotSubscription", entityId: id, after: { ...input, connectionId }, correlationId });
    return { id };
  }

  async unsubscribe(subscriptionId: string, actor: BotActor, correlationId: string): Promise<void> {
    const sub = await this.prisma.botSubscription.findFirst({ where: { id: subscriptionId, userId: actor.id, companyId: actor.companyId, disabledAt: null } });
    if (!sub) throw new BotError("SUBSCRIPTION_NOT_FOUND", "Subscription not found");
    await this.prisma.botSubscription.update({ where: { id: sub.id }, data: { disabledAt: new Date() } });
    await this.audit.log({ actorId: actor.id, action: "bot_subscription.removed", entityType: "BotSubscription", entityId: sub.id, correlationId });
  }
}
