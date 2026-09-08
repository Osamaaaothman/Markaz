import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { IPermissionService } from "@erp/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../auth/public.decorator.js";
import { PERMISSION_SERVICE } from "./identity.tokens.js";
import { PERMISSION_KEY, type RequiredPermission } from "./require-permission.decorator.js";

interface AuthenticatedRequest extends Request {
  user?: { id: string; companyId: string };
}

// docs/09-SECURITY-RULES.md §3: "Deny by default. A new endpoint with no permission
// declared must fail closed, and a test must prove it." This guard refuses access
// when @RequirePermission is missing — it does NOT fall through to "allowed".
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_SERVICE) private readonly permissions: IPermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.get<boolean | undefined>(IS_PUBLIC_KEY, context.getHandler());
    if (isPublic) {
      return true;
    }

    const required = this.reflector.get<RequiredPermission | undefined>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    if (!required) {
      // Authenticated (passed JwtAuthGuard) but no @RequirePermission declared —
      // fail closed, not open. docs/09-SECURITY-RULES.md §3.
      return false;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actorId = request.user?.id;
    if (!actorId) {
      throw new ForbiddenException();
    }

    const allowed = await this.permissions.can(
      actorId,
      required.action,
      required.resource,
      request.user?.companyId,
    );
    if (!allowed) {
      throw new ForbiddenException();
    }
    return true;
  }
}
