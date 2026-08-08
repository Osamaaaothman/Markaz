import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import type { AuthTokens, AuthUser, LoginRequest } from "@erp/shared";
import { PrismaService } from "../prisma/prisma.service";

const REFRESH_TOKEN_TTL_DAYS = 7;

type LoginResult = AuthTokens & { user: AuthUser };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: LoginRequest): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.issueTokens(user.id, user.email, user.name, user.role?.name ?? null);
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { include: { role: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Rotate: revoke the used token so it can't be replayed, then issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { user } = stored;
    if (!user.isActive || user.deletedAt) {
      throw new ForbiddenException("Account is inactive");
    }

    return this.issueTokens(user.id, user.email, user.name, user.role?.name ?? null);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    name: string,
    role: string | null,
  ): Promise<LoginResult> {
    const accessToken = await this.jwt.signAsync({ sub: userId, email, role });

    const refreshToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, user: { id: userId, email, name, role } };
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
