import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "@node-rs/argon2";
import { newId, type Clock } from "@erp/shared";
import type { IAuditLogger } from "@erp/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { AUDIT_LOGGER } from "../identity/identity.tokens.js";
import { CLOCK } from "../common/tokens.js";

// docs/09-SECURITY-RULES.md §2: lockout on repeated failed logins (per account here;
// per-IP throttling is a known gap for this slice — tracked, not silently dropped).
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AUDIT_LOGGER) private readonly audit: IAuditLogger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(email: string, password: string, correlationId: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Constant-shape response whether the email exists or not — docs/09 §2:
    // "no user enumeration in the response" (written for password reset, same
    // principle applies here).
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.lockedUntil && user.lockedUntil > this.clock.now()) {
      throw new ForbiddenException("Account temporarily locked");
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.audit.log({
        actorId: user.id,
        action: "login.failed",
        entityType: "User",
        entityId: user.id,
        correlationId,
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    await this.audit.log({
      actorId: user.id,
      action: "login.succeeded",
      entityType: "User",
      entityId: user.id,
      correlationId,
    });

    return this.issueTokenPair(user.id, user.companyId);
  }

  async refresh(refreshToken: string, correlationId: string): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < this.clock.now()) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (stored.revokedAt) {
      // Reuse of an already-rotated-away token — docs/09 §2 "reuse detection".
      // Treat as compromise: revoke every refresh token for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      await this.audit.log({
        actorId: stored.userId,
        action: "refresh_token.reuse_detected",
        entityType: "User",
        entityId: stored.userId,
        correlationId,
      });
      throw new UnauthorizedException("Refresh token reuse detected");
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const pair = await this.issueTokenPair(user.id, user.companyId);
    const newTokenHash = hashToken(pair.refreshToken);
    const newTokenRow = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: newTokenHash },
    });
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: this.clock.now(), replacedByTokenId: newTokenRow?.id ?? null },
    });

    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(this.clock.now().getTime() + LOCKOUT_DURATION_MS)
        : null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: attempts, lockedUntil },
    });
  }

  private async issueTokenPair(userId: string, companyId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, companyId },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const rawRefreshToken = randomBytes(48).toString("hex");
    await this.prisma.refreshToken.create({
      data: {
        id: newId(),
        userId,
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(this.clock.now().getTime() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
