import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";

export interface ItemSummary {
  readonly id: string;
  readonly ref: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly unit: string;
  readonly reorderPoint: string;
  readonly isActive: boolean;
  // The id of the item's current picture (an attachment), or null. It changes whenever the picture is replaced, so
  // the screen can use it to know when to fetch the image again.
  readonly pictureId: string | null;
}

export interface ItemListPage {
  readonly data: readonly ItemSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface ItemListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly q?: string | undefined;
  readonly includeInactive?: "true" | "false" | undefined;
}

export interface CreateItemInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly unit: string;
  readonly reorderPoint?: string | undefined;
}

export interface UpdateItemInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly unit?: string | undefined;
  readonly reorderPoint?: string | undefined;
  readonly isActive?: boolean | undefined;
}

export interface ItemActor {
  readonly id: string;
  readonly companyId: string;
}

export class ItemError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "ITEM_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ItemError";
  }
}

const ITEM_SELECT = {
  id: true,
  ref: true,
  code: true,
  name: true,
  nameAr: true,
  unit: true,
  reorderPoint: true,
  isActive: true,
} as const;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// A stock-keeping item — master data, deactivated rather than deleted once a stock movement
// references it (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4 principle extended to inventory).
export class ItemService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  // The newest picture (an ITEM attachment that was not removed) for each item, in one query.
  private async pictureIds(companyId: string, itemIds: readonly string[]): Promise<Map<string, string>> {
    const rows = itemIds.length
      ? await this.prisma.attachment.findMany({
          where: { companyId, ownerType: "ITEM", ownerId: { in: [...itemIds] }, deletedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, ownerId: true },
        })
      : [];
    const newest = new Map<string, string>();
    for (const row of rows) if (!newest.has(row.ownerId)) newest.set(row.ownerId, row.id);
    return newest;
  }

  async list(companyId: string, query: ItemListQuery): Promise<ItemListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const q = query.q?.trim();

    const items = await this.prisma.item.findMany({
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
      select: ITEM_SELECT,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const pictures = await this.pictureIds(companyId, page.map((i) => i.id));
    return {
      data: page.map((i) => ({ ...i, reorderPoint: i.reorderPoint.toFixed(4), pictureId: pictures.get(i.id) ?? null })),
      pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null },
    };
  }

  async create(input: CreateItemInput, actor: ItemActor, correlationId: string): Promise<ItemSummary> {
    const duplicate = await this.prisma.item.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code: input.code } },
      select: { id: true },
    });
    if (duplicate) throw new ItemError("DUPLICATE_CODE", "An item with this code already exists");

    const id = newId();
    const item = await this.prisma.$transaction(async (tx) => {
      const ref = await allocateRef(tx, actor.companyId, "item");
      return tx.item.create({
        data: {
          id,
          ref,
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          nameAr: blankToNull(input.nameAr),
          unit: input.unit,
          reorderPoint: input.reorderPoint ?? "0",
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: ITEM_SELECT,
      });
    });

    const result = { ...item, reorderPoint: item.reorderPoint.toFixed(4), pictureId: null };
    await this.audit.log({ actorId: actor.id, action: "item.created", entityType: "Item", entityId: id, after: result, correlationId });
    return result;
  }

  async update(id: string, input: UpdateItemInput, actor: ItemActor, correlationId: string): Promise<ItemSummary> {
    const before = await this.prisma.item.findFirst({ where: { id, companyId: actor.companyId }, select: ITEM_SELECT });
    if (!before) throw new ItemError("ITEM_NOT_FOUND", "Item not found");

    const after = await this.prisma.item.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: blankToNull(input.nameAr) } : {}),
        ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: ITEM_SELECT,
    });

    const pictures = await this.pictureIds(actor.companyId, [id]);
    const result = { ...after, reorderPoint: after.reorderPoint.toFixed(4), pictureId: pictures.get(id) ?? null };
    await this.audit.log({
      actorId: actor.id,
      action: "item.updated",
      entityType: "Item",
      entityId: id,
      before: { ...before, reorderPoint: before.reorderPoint.toFixed(4), pictureId: result.pictureId },
      after: result,
      correlationId,
    });
    return result;
  }
}
