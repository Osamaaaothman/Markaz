import { createHash, randomBytes } from "node:crypto";
import type { IAuditLogger } from "@erp/core";
import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";

// Personal tokens for the read-only MCP endpoint. Framework-free so its specs run under plain Jest.
//
// A token is 32 random bytes, so a plain SHA-256 is enough to store it (no password stretching is
// needed for a value nobody can guess). The token itself is returned once, at creation, and never again.
export const ACCESS_TOKEN_PREFIX = "mkz_mcp_";
const PREFIX_SHOWN = ACCESS_TOKEN_PREFIX.length + 4;
const MAX_TOKENS_PER_USER = 10;
// Writing last_used_at on every MCP call would be a write per request; once a minute is enough to show.
const LAST_USED_GRANULARITY_MS = 60_000;

export class AccessTokenError extends Error {
  constructor(readonly code: "NAME_REQUIRED" | "TOO_MANY_TOKENS" | "TOKEN_NOT_FOUND" | "INVALID_SCOPE" | "FORBIDDEN") {
    super(code);
    this.name = "AccessTokenError";
  }
}

// read: read tools only. review: every write becomes a card waiting for approval in the app.
// write: the app's auto-mode rules — low-risk writes run at once, high-risk ones still wait for approval.
export const ACCESS_TOKEN_SCOPES = ["read", "review", "write"] as const;
export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];
// The permission a user needs to create a token of each scope (the same as the matching chat mode).
const SCOPE_PERMISSION: Readonly<Record<AccessTokenScope, string>> = { read: "use", review: "interact", write: "auto" };

// The token a request was authenticated with (set by JwtAuthGuard on @AllowAccessToken() routes).
export interface RequestAccessToken {
  readonly id: string;
  readonly name: string;
  readonly scope: AccessTokenScope;
}

function asScope(value: string): AccessTokenScope {
  return (ACCESS_TOKEN_SCOPES as readonly string[]).includes(value) ? (value as AccessTokenScope) : "read";
}

export interface AccessTokenView {
  readonly id: string;
  readonly name: string;
  readonly scope: AccessTokenScope;
  readonly tokenPrefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeAccessToken(bearer: string): boolean {
  return bearer.startsWith(ACCESS_TOKEN_PREFIX);
}

export class AccessTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(actor: { id: string; companyId: string }): Promise<AccessTokenView[]> {
    const rows = await this.prisma.aiAccessToken.findMany({
      where: { companyId: actor.companyId, userId: actor.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, scope: true, tokenPrefix: true, createdAt: true, lastUsedAt: true },
    });
    return rows.map((r) => ({ ...r, scope: asScope(r.scope) }));
  }

  // `can` checks the creator's own permission (ai_assistant:<action>) for the scope asked for.
  async create(
    actor: { id: string; companyId: string },
    rawName: string,
    rawScope: string,
    can: (resource: string, action: string) => Promise<boolean>,
  ): Promise<AccessTokenView & { token: string }> {
    const name = rawName.trim().slice(0, 80);
    if (!name) throw new AccessTokenError("NAME_REQUIRED");
    if (!(ACCESS_TOKEN_SCOPES as readonly string[]).includes(rawScope)) throw new AccessTokenError("INVALID_SCOPE");
    const scope = rawScope as AccessTokenScope;
    if (!(await can("ai_assistant", SCOPE_PERMISSION[scope]))) throw new AccessTokenError("FORBIDDEN");
    const active = await this.prisma.aiAccessToken.count({ where: { companyId: actor.companyId, userId: actor.id, revokedAt: null } });
    if (active >= MAX_TOKENS_PER_USER) throw new AccessTokenError("TOO_MANY_TOKENS");
    const token = ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const row = await this.prisma.aiAccessToken.create({
      data: { id: newId(), companyId: actor.companyId, userId: actor.id, name, scope, tokenHash: hashAccessToken(token), tokenPrefix: token.slice(0, PREFIX_SHOWN) },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true },
    });
    // Never the token or its hash in the audit log.
    await this.audit.log({ actorId: actor.id, action: "ai_access_token.created", entityType: "AiAccessToken", entityId: row.id, after: { name, scope, tokenPrefix: row.tokenPrefix }, correlationId: `ai-token:${row.id}` });
    return { ...row, scope, token };
  }

  async revoke(actor: { id: string; companyId: string }, id: string): Promise<void> {
    const done = await this.prisma.aiAccessToken.updateMany({ where: { id, companyId: actor.companyId, userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (done.count !== 1) throw new AccessTokenError("TOKEN_NOT_FOUND");
    await this.audit.log({ actorId: actor.id, action: "ai_access_token.revoked", entityType: "AiAccessToken", entityId: id, correlationId: `ai-token:${id}` });
  }

  // The user a bearer token acts for, or null. A revoked token, or one whose user was deactivated, is refused.
  async verify(token: string): Promise<{ id: string; companyId: string; token: RequestAccessToken } | null> {
    if (!looksLikeAccessToken(token)) return null;
    const row = await this.prisma.aiAccessToken.findUnique({
      where: { tokenHash: hashAccessToken(token) },
      select: { id: true, companyId: true, userId: true, name: true, scope: true, revokedAt: true, lastUsedAt: true, user: { select: { isActive: true } } },
    });
    if (!row || row.revokedAt || !row.user.isActive) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
      await this.prisma.aiAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return { id: row.userId, companyId: row.companyId, token: { id: row.id, name: row.name, scope: asScope(row.scope) } };
  }
}
