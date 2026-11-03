import { Prisma, type PrismaClient } from "@erp/db";

// Reading the audit log. The log is append-only and this service only reads it.
//
// Tenant scope: a row belongs to a company if it carries that company, or (rows written before the company was recorded) if its actor is
// one of that company's users. A row with neither is never shown to anyone.

export interface AuditLogQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly action?: string | undefined;
  readonly actorId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string;
}

export interface AuditLogPage {
  readonly data: readonly AuditLogEntry[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export class AuditQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(companyId: string, query: AuditLogQuery): Promise<AuditLogPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 200);
    const users = await this.prisma.user.findMany({ where: { companyId }, select: { id: true, email: true } });
    const userIds = users.map((u) => u.id);
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const where: Prisma.AuditLogWhereInput = {
      AND: [
        { OR: [{ companyId }, { companyId: null, actorId: { in: userIds } }] },
        ...(query.entityType ? [{ entityType: query.entityType }] : []),
        ...(query.entityId ? [{ entityId: query.entityId }] : []),
        ...(query.action ? [{ action: { contains: query.action, mode: "insensitive" as const } }] : []),
        ...(query.actorId ? [{ actorId: query.actorId }] : []),
        ...(query.from ? [{ createdAt: { gte: new Date(`${query.from}T00:00:00.000Z`) } }] : []),
        ...(query.to ? [{ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } }] : []),
      ],
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorId: r.actorId,
        actorEmail: emailById.get(r.actorId) ?? null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.beforeJson,
        after: r.afterJson,
        correlationId: r.correlationId,
      })),
      pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null },
    };
  }

  // The entity types and the users that appear in this company's log, to fill the filters.
  async filters(companyId: string): Promise<{ readonly entityTypes: readonly string[]; readonly users: readonly { readonly id: string; readonly email: string }[] }> {
    const users = await this.prisma.user.findMany({ where: { companyId }, select: { id: true, email: true }, orderBy: { email: "asc" } });
    const types = await this.prisma.auditLog.findMany({
      where: { OR: [{ companyId }, { companyId: null, actorId: { in: users.map((u) => u.id) } }] },
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    });
    return { entityTypes: types.map((t) => t.entityType), users };
  }
}
