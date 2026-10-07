import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";

export type PurchaseRequestStatus = "PENDING" | "PROCESSED" | "REJECTED";

export class PurchaseRequestError extends Error {
  constructor(
    readonly code: "EMPTY_REQUEST" | "ITEM_NOT_FOUND" | "REQUEST_NOT_FOUND" | "NOT_PENDING",
    message: string,
  ) {
    super(message);
    this.name = "PurchaseRequestError";
  }
}

export interface PurchaseRequestLineInput {
  readonly itemId: string;
  readonly quantity: string;
  readonly notes?: string | undefined;
}

export interface CreatePurchaseRequestInput {
  readonly notes?: string | undefined;
  readonly lines: readonly PurchaseRequestLineInput[];
}

export interface PurchaseRequestActor {
  readonly id: string;
  readonly companyId: string;
}

export interface PurchaseRequestSummary {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseRequestStatus;
  readonly notes: string | null;
  readonly rejectionReason: string | null;
  readonly lineCount: number;
  readonly purchaseOrderId: string | null;
  readonly createdAt: string;
}

export interface PurchaseRequestDetail extends PurchaseRequestSummary {
  readonly lines: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly itemCode: string;
    readonly itemName: string;
    readonly itemNameAr: string | null;
    readonly unit: string;
    readonly quantity: string;
    readonly notes: string | null;
  }[];
}

export interface PurchaseRequestListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly status?: PurchaseRequestStatus | undefined;
}

export interface PurchaseRequestListPage {
  readonly data: readonly PurchaseRequestSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

type RequestRow = Prisma.PurchaseRequestGetPayload<{ include: { _count: { select: { lines: true } } } }>;

function toSummary(row: RequestRow): PurchaseRequestSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as PurchaseRequestStatus,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    lineCount: row._count.lines,
    purchaseOrderId: row.purchaseOrderId,
    createdAt: row.createdAt.toISOString(),
  };
}

// An internal request to buy. It moves nothing in stock or in the ledger — it only records what
// someone needs, so a buyer can turn it into an order (PurchaseOrderService.create with
// purchaseRequestId) or turn it down here.
export class PurchaseRequestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async create(input: CreatePurchaseRequestInput, actor: PurchaseRequestActor, correlationId: string): Promise<PurchaseRequestSummary> {
    if (input.lines.length === 0) throw new PurchaseRequestError("EMPTY_REQUEST", "A purchase request needs at least one line");

    const id = newId();
    const created = await this.prisma.$transaction(async (tx) => {
      const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId: actor.companyId, isActive: true }, select: { id: true } });
      if (items.length !== itemIds.length) throw new PurchaseRequestError("ITEM_NOT_FOUND", "An item on the request was not found");

      const now = new Date();
      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, now);
      const number = await allocateDocumentNumber(tx, actor.companyId, "purchase_request", "PRQ", fiscalYear);

      return tx.purchaseRequest.create({
        data: {
          id,
          companyId: actor.companyId,
          number,
          status: "PENDING",
          notes: blankToNull(input.notes),
          requestedBy: actor.id,
          correlationId,
          lines: {
            create: input.lines.map((l, index) => ({
              id: newId(),
              itemId: l.itemId,
              quantity: new Prisma.Decimal(l.quantity),
              notes: blankToNull(l.notes),
              lineNumber: index + 1,
            })),
          },
        },
        include: { _count: { select: { lines: true } } },
      });
    });

    const summary = toSummary(created);
    await this.audit.log({ actorId: actor.id, action: "purchase_request.created", entityType: "PurchaseRequest", entityId: id, after: { ...summary }, correlationId });
    return summary;
  }

  async list(companyId: string, query: PurchaseRequestListQuery): Promise<PurchaseRequestListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.purchaseRequest.findMany({
      where: { companyId, ...(query.status ? { status: query.status } : {}) },
      include: { _count: { select: { lines: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map(toSummary),
      pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null },
    };
  }

  async get(companyId: string, id: string): Promise<PurchaseRequestDetail> {
    const row = await this.prisma.purchaseRequest.findFirst({
      where: { id, companyId },
      include: {
        _count: { select: { lines: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { item: true } },
      },
    });
    if (!row) throw new PurchaseRequestError("REQUEST_NOT_FOUND", "Purchase request not found");
    return {
      ...toSummary(row),
      lines: row.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        itemNameAr: l.item.nameAr,
        unit: l.item.unit,
        quantity: l.quantity.toFixed(4),
        notes: l.notes,
      })),
    };
  }

  async reject(id: string, reason: string, actor: PurchaseRequestActor, correlationId: string): Promise<PurchaseRequestSummary> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM purchase_requests WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new PurchaseRequestError("REQUEST_NOT_FOUND", "Purchase request not found");
      if (current.status !== "PENDING") throw new PurchaseRequestError("NOT_PENDING", "Only a pending request can be rejected");
      return tx.purchaseRequest.update({
        where: { id },
        data: { status: "REJECTED", rejectionReason: reason.trim(), decidedBy: actor.id, decidedAt: new Date() },
        include: { _count: { select: { lines: true } } },
      });
    });
    const summary = toSummary(updated);
    await this.audit.log({ actorId: actor.id, action: "purchase_request.rejected", entityType: "PurchaseRequest", entityId: id, after: { ...summary }, correlationId });
    return summary;
  }
}
