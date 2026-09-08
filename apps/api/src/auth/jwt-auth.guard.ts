import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; companyId: string };
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

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice("Bearer ".length),
      );
      request.user = { id: payload.sub, companyId: payload.companyId };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
