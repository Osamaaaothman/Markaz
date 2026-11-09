import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";

export interface PartySummary {
  readonly id: string;
  readonly ref: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly vatNumber: string | null;
  readonly commercialRegistration: string | null;
  readonly streetName: string | null;
  readonly additionalStreetName: string | null;
  readonly buildingNumber: string | null;
  readonly additionalNumber: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
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

// Address + VAT/CR fields are optional everywhere: most parties (a walk-in customer, an
// informal supplier) never need them, and the ones that do are filled in once they're known
// rather than blocking party creation on paperwork.
export interface CreatePartyInput {
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly kind: string;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly vatNumber?: string | null | undefined;
  readonly commercialRegistration?: string | null | undefined;
  readonly streetName?: string | null | undefined;
  readonly additionalStreetName?: string | null | undefined;
  readonly buildingNumber?: string | null | undefined;
  readonly additionalNumber?: string | null | undefined;
  readonly district?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  readonly countryCode?: string | null | undefined;
}

// A field left out (undefined) is kept; null or "" clears an optional detail.
export interface UpdatePartyInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly kind?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly vatNumber?: string | null | undefined;
  readonly commercialRegistration?: string | null | undefined;
  readonly streetName?: string | null | undefined;
  readonly additionalStreetName?: string | null | undefined;
  readonly buildingNumber?: string | null | undefined;
  readonly additionalNumber?: string | null | undefined;
  readonly district?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  readonly countryCode?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface PartyActor {
  readonly id: string;
  readonly companyId: string;
}

const PARTY_SELECT = {
  id: true,
  ref: true,
  name: true,
  nameAr: true,
  kind: true,
  phone: true,
  email: true,
  vatNumber: true,
  commercialRegistration: true,
  streetName: true,
  additionalStreetName: true,
  buildingNumber: true,
  additionalNumber: true,
  district: true,
  city: true,
  postalCode: true,
  countryCode: true,
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
                { ref: { contains: q, mode: "insensitive" } },
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
    // The reference is allocated in the same transaction as the insert, so a failed insert
    // never burns a number.
    const party = await this.prisma.$transaction(async (tx) => {
      const ref = await allocateRef(tx, actor.companyId, "party");
      return tx.party.create({
        data: {
          id,
          ref,
          companyId: actor.companyId,
          name: input.name.trim(),
          nameAr: blankToNull(input.nameAr),
          kind: input.kind,
          phone: blankToNull(input.phone),
          email: blankToNull(input.email),
          vatNumber: blankToNull(input.vatNumber),
          commercialRegistration: blankToNull(input.commercialRegistration),
          streetName: blankToNull(input.streetName),
          additionalStreetName: blankToNull(input.additionalStreetName),
          buildingNumber: blankToNull(input.buildingNumber),
          additionalNumber: blankToNull(input.additionalNumber),
          district: blankToNull(input.district),
          city: blankToNull(input.city),
          postalCode: blankToNull(input.postalCode),
          ...(input.countryCode !== undefined ? { countryCode: blankToNull(input.countryCode) } : {}),
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: PARTY_SELECT,
      });
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
        ...(input.vatNumber !== undefined ? { vatNumber: blankToNull(input.vatNumber) } : {}),
        ...(input.commercialRegistration !== undefined ? { commercialRegistration: blankToNull(input.commercialRegistration) } : {}),
        ...(input.streetName !== undefined ? { streetName: blankToNull(input.streetName) } : {}),
        ...(input.additionalStreetName !== undefined ? { additionalStreetName: blankToNull(input.additionalStreetName) } : {}),
        ...(input.buildingNumber !== undefined ? { buildingNumber: blankToNull(input.buildingNumber) } : {}),
        ...(input.additionalNumber !== undefined ? { additionalNumber: blankToNull(input.additionalNumber) } : {}),
        ...(input.district !== undefined ? { district: blankToNull(input.district) } : {}),
        ...(input.city !== undefined ? { city: blankToNull(input.city) } : {}),
        ...(input.postalCode !== undefined ? { postalCode: blankToNull(input.postalCode) } : {}),
        ...(input.countryCode !== undefined ? { countryCode: blankToNull(input.countryCode) } : {}),
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
