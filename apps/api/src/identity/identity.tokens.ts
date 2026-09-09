// Injection tokens for the Core contracts — TypeScript interfaces have no runtime
// identity, so NestJS DI needs a token to bind them to. Every module depends on
// these tokens, never on `PrismaPermissionService`/`PrismaAuditLogger` directly
// (docs/02-ARCHITECTURE-RULES.md §3: modules request the contract, not an impl).
export const PERMISSION_SERVICE = Symbol("IPermissionService");
export const AUDIT_LOGGER = Symbol("IAuditLogger");
