import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";

export interface PartySummary {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isActive: boolean;
}

// docs/07-API-RULES.md §6 list envelope, same shape as the journal entries list.
export interface PartyListPage {
  readonly data: readonly PartySummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface PartyListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly q?: string | undefined;
  readonly kind?: string | undefined;
  readonly includeInactive?: "true" | "false" | undefined;
}

export interface CreatePartyInput {
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly kind: string;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
}

// A field left out (undefined) is kept; null or "" clears an optional detail.
export interface UpdatePartyInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly kind?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface PartyActor {
  readonly id: string;
  readonly companyId: string;
}

const PARTY_SELECT = {
  id: true,
  name: true,
  nameAr: true,
  kind: true,
  phone: true,
  email: true,
  isActive: true,
} as const;

// "" and null both mean "clear this optional detail".
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Parties (people, companies, employees) that accounts can be kept for. Framework-free like
// the other core services: the API wraps it and maps a `null` result to HTTP 404, and every
// query carries the company id (docs/03-MULTI-TENANCY-RULES.md).
export class PartyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: PartyListQuery): Promise<PartyListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const q = query.q?.trim();

    const parties = await this.prisma.party.findMany({
      where: {
        companyId,
        ...(query.includeInactive === "true" ? {} : { isActive: true }),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { nameAr: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: PARTY_SELECT,
      // id as the tie-breaker keeps the cursor position stable between equal names.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = parties.length > limit;
    const page = hasMore ? parties.slice(0, limit) : parties;
    return { data: page, pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async create(input: CreatePartyInput, actor: PartyActor, correlationId: string): Promise<PartySummary> {
    const id = newId();
    const party = await this.prisma.party.create({
      data: {
        id,
        companyId: actor.companyId,
        name: input.name.trim(),
        nameAr: blankToNull(input.nameAr),
        kind: input.kind,
        phone: blankToNull(input.phone),
        email: blankToNull(input.email),
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: PARTY_SELECT,
    });

    await this.audit.log({ actorId: actor.id, action: "party.created", entityType: "Party", entityId: id, after: party, correlationId });
    return party;
  }

  // null when the party does not exist in the caller's company.
  async update(id: string, input: UpdatePartyInput, actor: PartyActor, correlationId: string): Promise<PartySummary | null> {
    const before = await this.prisma.party.findFirst({ where: { id, companyId: actor.companyId }, select: PARTY_SELECT });
    if (!before) return null;

    const after = await this.prisma.party.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: blankToNull(input.nameAr) } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.phone !== undefined ? { phone: blankToNull(input.phone) } : {}),
        ...(input.email !== undefined ? { email: blankToNull(input.email) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: PARTY_SELECT,
    });

    await this.audit.log({ actorId: actor.id, action: "party.updated", entityType: "Party", entityId: id, before, after, correlationId });
    return after;
  }
}
