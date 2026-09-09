import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface CurrentUserPayload {
  readonly id: string;
  readonly companyId: string;
}

interface AuthenticatedRequest extends Request {
  user?: CurrentUserPayload;
}

// Populated by JwtAuthGuard, which always runs first (see AppModule's APP_GUARD
// order) on any non-@Public() route — so `user` is guaranteed present here.
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error("CurrentUser used on a route with no authenticated user");
    }
    return request.user;
  },
);
