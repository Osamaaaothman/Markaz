import { SetMetadata } from "@nestjs/common";

export const AUTHENTICATED_ONLY_KEY = "authenticatedOnly";

// A THIRD case alongside @Public() (no auth at all) and @RequirePermission (a
// specific granted permission) — docs/09-SECURITY-RULES.md §3's "deny by default"
// is about undeclared endpoints, not about every authenticated action needing its
// own grantable permission. "Read my own profile" isn't a business permission
// Osama would ever want to revoke from one role and not another (unlike
// "post a journal entry") — it's inherent to being an authenticated principal.
// Grep for @AuthenticatedOnly() to see the full, deliberately short list of routes
// that use this instead of @RequirePermission.
export const AuthenticatedOnly = (): MethodDecorator => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
