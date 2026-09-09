import type { Prisma, PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { AuditEvent, IAuditLogger } from "../contracts.js";

// The ONLY implementation of IAuditLogger — docs/02-ARCHITECTURE-RULES.md §3.4.
// Append-only: this class exposes no update or delete method, and the database
// role the running app connects as has no UPDATE/DELETE grant on audit_log either
// (see the M1 migration and docker-compose.yml) — enforced at both layers on purpose.
export class PrismaAuditLogger implements IAuditLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async log(event: AuditEvent): Promise<void> {
    // docs/02-ARCHITECTURE-RULES.md §3.4: "Writing audit records must not silently
    // fail. If audit fails, the operation fails." — no try/catch swallowing here;
    // a failed insert propagates and the caller's transaction (once M2 wires audit
    // writes into the same transaction as the business change) rolls back with it.
    // `exactOptionalPropertyTypes` (tsconfig.base.json) treats an explicit
    // `undefined` differently from an omitted key — Prisma's JSON input types want
    // the key genuinely absent, not present-and-undefined, so these are spread in
    // conditionally rather than always assigned.
    await this.prisma.auditLog.create({
      data: {
        id: newId(),
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        // Cast at this one boundary: AuditEvent.before/after are our own domain
        // type (Record<string, unknown>, deliberately generic for callers), Prisma
        // wants its own structural JSON type — the values are always plain
        // JSON-serializable objects in practice, so this is a boundary conversion,
        // not a real type-safety escape hatch.
        ...(event.before !== undefined
          ? { beforeJson: event.before as Prisma.InputJsonValue }
          : {}),
        ...(event.after !== undefined ? { afterJson: event.after as Prisma.InputJsonValue } : {}),
        correlationId: event.correlationId,
      },
    });
  }
}
