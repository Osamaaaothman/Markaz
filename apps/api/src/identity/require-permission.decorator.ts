import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "requiredPermission";

export interface RequiredPermission {
  readonly action: string;
  readonly resource: string;
}

// docs/09-SECURITY-RULES.md §3: "Deny by default. A new endpoint with no permission
// declared must fail closed" — see PermissionGuard, which refuses any route missing
// this decorator rather than defaulting to allow.
export const RequirePermission = (resource: string, action: string): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, { resource, action } satisfies RequiredPermission);
