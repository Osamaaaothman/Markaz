import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";

export interface WarehouseSummary {
  readonly id: string;
  readonly ref: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly isActive: boolean;
}

// docs/07-API-RULES.md §6 list envelope, same shape as parties/chart-of-accounts.
export interface WarehouseListPage {
  readonly data: readonly WarehouseSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface WarehouseListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly q?: string | undefined;
  readonly includeInactive?: "true" | "false" | undefined;
}

export interface CreateWarehouseInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null | undefined;
}

export interface UpdateWarehouseInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface WarehouseActor {
  readonly id: string;
  readonly companyId: string;
}

export class WarehouseError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "WAREHOUSE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "WarehouseError";
  }
}

const WAREHOUSE_SELECT = {
  id: true,
  ref: true,
  code: true,
  name: true,
  nameAr: true,
  isActive: true,
} as const;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Warehouses an item can hold stock in — master data, deactivated rather than deleted once a
// stock movement references it (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4 principle extended).
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: WarehouseListQuery): Promise<WarehouseListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const q = query.q?.trim();

    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        companyId,
        ...(query.includeInactive === "true" ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { nameAr: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: WAREHOUSE_SELECT,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = warehouses.length > limit;
    const page = hasMore ? warehouses.slice(0, limit) : warehouses;
    return { data: page, pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async create(input: CreateWarehouseInput, actor: WarehouseActor, correlationId: string): Promise<WarehouseSummary> {
    const duplicate = await this.prisma.warehouse.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: input.code } },
      select: { id: true },
    });
    if (duplicate) throw new WarehouseError("DUPLICATE_CODE", "A warehouse with this code already exists");

    const id = newId();
    const warehouse = await this.prisma.$transaction(async (tx) => {
      const ref = await allocateRef(tx, actor.companyId, "warehouse");
      return tx.warehouse.create({
        data: {
          id,
          ref,
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          nameAr: blankToNull(input.nameAr),
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: WAREHOUSE_SELECT,
      });
    });

    await this.audit.log({ actorId: actor.id, action: "warehouse.created", entityType: "Warehouse", entityId: id, after: warehouse, correlationId });
    return warehouse;
  }

  async update(id: string, input: UpdateWarehouseInput, actor: WarehouseActor, correlationId: string): Promise<WarehouseSummary> {
    const before = await this.prisma.warehouse.findFirst({ where: { id, companyId: actor.companyId }, select: WAREHOUSE_SELECT });
    if (!before) throw new WarehouseError("WAREHOUSE_NOT_FOUND", "Warehouse not found");

    const after = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: blankToNull(input.nameAr) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: WAREHOUSE_SELECT,
    });

    await this.audit.log({ actorId: actor.id, action: "warehouse.updated", entityType: "Warehouse", entityId: id, before, after, correlationId });
    return after;
  }
}
