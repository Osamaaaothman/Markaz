import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { AccessTokenService, looksLikeAccessToken, type RequestAccessToken } from "../ai/mcp/access-tokens.js";
import { ALLOW_ACCESS_TOKEN_KEY } from "./allow-access-token.decorator.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; companyId: string };
  accessToken?: RequestAccessToken;
}

interface AccessTokenPayload {
  sub: string;
  companyId: string;
}

// Registered as a global guard (see AppModule) — docs/07-API-RULES.md §8:
// "Authentication on every route by default; public routes are explicitly opted
// out." @Public() is the opt-out.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.get<boolean | undefined>(IS_PUBLIC_KEY, context.getHandler());
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException();
    }

    const bearer = header.slice("Bearer ".length);
    // A personal MCP token works only on the routes marked @AllowAccessToken(), never anywhere else.
    if (looksLikeAccessToken(bearer)) {
      if (!this.reflector.get<boolean | undefined>(ALLOW_ACCESS_TOKEN_KEY, context.getHandler())) {
        throw new UnauthorizedException();
      }
      const verified = await this.accessTokens.verify(bearer);
      if (!verified) throw new UnauthorizedException();
      request.user = { id: verified.id, companyId: verified.companyId };
      request.accessToken = verified.token;
      return true;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(bearer);
      request.user = { id: payload.sub, companyId: payload.companyId };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
