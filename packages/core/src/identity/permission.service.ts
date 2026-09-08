import type { PrismaClient } from "@erp/db";
import type { IPermissionService } from "../contracts.js";

// The ONLY implementation of IPermissionService — docs/02-ARCHITECTURE-RULES.md §3.2.
// Permissions are data (role -> permission), never a hard-coded role-name check.
// `if (user.role === 'admin')` anywhere else in this codebase is a defect.
//
// Permission codes are "<resource>:<action>", e.g. "sales_invoice:create".
export class PrismaPermissionService implements IPermissionService {
  constructor(private readonly prisma: PrismaClient) {}

  async can(actorId: string, action: string, resource: string, scope?: string): Promise<boolean> {
    const code = `${resource}:${action}`;

    // docs/09-SECURITY-RULES.md §3: "Deny by default." An inactive/locked/unknown
    // user, or one with no role granting this permission, gets false — never an
    // exception that a caller might accidentally treat as "allowed".
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { isActive: true, companyId: true },
    });
    if (!user || !user.isActive) {
      return false;
    }

    // Scope covers company/branch, not just the action (docs/02 §3.2). For M1 the
    // only scope that exists is "this user's own company" — branch-level scoping
    // arrives with the Branch model once a module actually needs it.
    if (scope && scope !== user.companyId) {
      return false;
    }

    const grant = await this.prisma.rolePermission.findFirst({
      where: {
        permission: { code },
        role: { users: { some: { userId: actorId } } },
      },
      select: { roleId: true },
    });

    return grant !== null;
  }
}
