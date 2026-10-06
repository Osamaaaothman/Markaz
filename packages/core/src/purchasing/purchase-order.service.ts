import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { allocateDocumentNumber } from "../reference.js";

export const PURCHASE_ORDER_APPROVAL_SUBJECT = "purchase_order";

export type PurchaseOrderStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export class PurchaseOrderError extends Error {
  constructor(
    readonly code:
      | "EMPTY_ORDER"
      | "SUPPLIER_NOT_FOUND"
      | "ITEM_NOT_FOUND"
      | "ORDER_NOT_FOUND"
      | "REQUEST_NOT_FOUND"
      | "REQUEST_NOT_PENDING"
      | "NOT_PENDING_APPROVAL"
      | "NOT_CANCELLABLE",
    message: string,
  ) {
    super(message);
    this.name = "PurchaseOrderError";
  }
}

export interface PurchaseOrderLineInput {
  readonly itemId: string;
  readonly quantity: string;
  readonly unitPrice: string;
}

export interface CreatePurchaseOrderInput {
  readonly supplierId: string;
  readonly orderDate: Date;
  readonly expectedDate?: Date | undefined;
  readonly notes?: string | undefined;
  // Set when this order fulfils a pending purchase request; the request becomes PROCESSED.
  readonly purchaseRequestId?: string | undefined;
  readonly lines: readonly PurchaseOrderLineInput[];
}

export interface PurchaseOrderActor {
  readonly id: string;
  readonly companyId: string;
}

export interface PurchaseOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseOrderStatus;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly orderDate: string;
  readonly expectedDate: string | null;
  readonly currency: string;
  readonly totalAmount: string;
  readonly lineCount: number;
  readonly createdAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  readonly notes: string | null;
  readonly lines: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly itemCode: string;
    readonly itemName: string;
    readonly itemNameAr: string | null;
    readonly unit: string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly receivedQuantity: string;
    readonly lineTotal: string;
  }[];
}

export interface PurchaseOrderListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly status?: PurchaseOrderStatus | undefined;
  readonly supplierId?: string | undefined;
}

export interface PurchaseOrderListPage {
  readonly data: readonly PurchaseOrderSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface PurchaseOrderCreated {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseOrderStatus;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: { supplier: true; _count: { select: { lines: true } } } }>;

function toSummary(row: OrderRow): PurchaseOrderSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status as PurchaseOrderStatus,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    supplierNameAr: row.supplier.nameAr,
    orderDate: dateOnly(row.orderDate),
    expectedDate: row.expectedDate ? dateOnly(row.expectedDate) : null,
    currency: row.currency,
    totalAmount: row.totalAmount.toFixed(4),
    lineCount: row._count.lines,
    createdAt: row.createdAt.toISOString(),
  };
}

// An order to one supplier. Orders do not touch the ledger (nothing is owed until goods arrive);
// they gate what can be received and carry the agreed price the receipt is valued at.
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly approvals: ApprovalService,
    private readonly audit: IAuditLogger,
  ) {}

  async create(
    input: CreatePurchaseOrderInput,
    actor: PurchaseOrderActor,
    correlationId: string,
  ): Promise<PurchaseOrderCreated> {
    if (input.lines.length === 0) throw new PurchaseOrderError("EMPTY_ORDER", "A purchase order needs at least one line");

    const id = newId();
    const created = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.party.findFirst({
        where: { id: input.supplierId, companyId: actor.companyId, isActive: true },
        select: { id: true },
      });
      if (!supplier) throw new PurchaseOrderError("SUPPLIER_NOT_FOUND", "Supplier not found");

      const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId: actor.companyId, isActive: true }, select: { id: true } });
      if (items.length !== itemIds.length) throw new PurchaseOrderError("ITEM_NOT_FOUND", "An item on the order was not found");

      const currency = await companyCurrency(tx, actor.companyId);
      const lineRecords = input.lines.map((l, index) => {
        const quantity = new Prisma.Decimal(l.quantity);
        const unitPrice = new Prisma.Decimal(l.unitPrice);
        return { id: newId(), itemId: l.itemId, quantity, unitPrice, lineNumber: index + 1, total: quantity.times(unitPrice).toDecimalPlaces(4) };
      });
      const total = lineRecords.reduce((sum, l) => sum.plus(l.total), new Prisma.Decimal(0));

      const approval = await this.approvals.evaluateAndRequest(tx, {
        companyId: actor.companyId,
        subjectType: PURCHASE_ORDER_APPROVAL_SUBJECT,
        subjectId: id,
        amount: total.toFixed(4),
        currency,
        requestedBy: actor.id,
        correlationId,
      });
      const status: PurchaseOrderStatus = approval ? "PENDING_APPROVAL" : "APPROVED";

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.orderDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "purchase_order", "PO", fiscalYear);

      await tx.purchaseOrder.create({
        data: {
          id,
          companyId: actor.companyId,
          number,
          supplierId: input.supplierId,
          status,
          orderDate: input.orderDate,
          expectedDate: input.expectedDate ?? null,
          currency,
          totalAmount: total,
          notes: blankToNull(input.notes),
          approvalRequestId: approval?.id ?? null,
          requestedBy: actor.id,
          correlationId,
          lines: {
            create: lineRecords.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineNumber: l.lineNumber,
            })),
          },
        },
      });

      if (input.purchaseRequestId) {
        const locked = await tx.$queryRaw<{ status: string }[]>`
          SELECT status FROM purchase_requests WHERE id = ${input.purchaseRequestId} AND company_id = ${actor.companyId} FOR UPDATE
        `;
        const request = locked[0];
        if (!request) throw new PurchaseOrderError("REQUEST_NOT_FOUND", "Purchase request not found");
        if (request.status !== "PENDING") throw new PurchaseOrderError("REQUEST_NOT_PENDING", "This purchase request is already decided");
        await tx.purchaseRequest.update({
          where: { id: input.purchaseRequestId },
          data: { status: "PROCESSED", purchaseOrderId: id, decidedBy: actor.id, decidedAt: new Date() },
        });
      }

      return { id, number, status };
    });

    await this.audit.log({ actorId: actor.id, action: "purchase_order.created", entityType: "PurchaseOrder", entityId: id, after: { ...created }, correlationId });
    return created;
  }

  async list(companyId: string, query: PurchaseOrderListQuery): Promise<PurchaseOrderListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      include: { supplier: true, _count: { select: { lines: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(companyId: string, id: string): Promise<PurchaseOrderDetail> {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: {
        supplier: true,
        _count: { select: { lines: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { item: true } },
      },
    });
    if (!row) throw new PurchaseOrderError("ORDER_NOT_FOUND", "Purchase order not found");
    return {
      ...toSummary(row),
      notes: row.notes,
      lines: row.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        itemNameAr: l.item.nameAr,
        unit: l.item.unit,
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        receivedQuantity: l.receivedQuantity.toFixed(4),
        lineTotal: l.quantity.times(l.unitPrice).toDecimalPlaces(4).toFixed(4),
      })),
    };
  }

  // Approve or reject an order that crossed the approval threshold. WHO may decide is the
  // controller's permission check (purchase_order:approve); this is only the state machine.
  async decide(
    id: string,
    decision: "APPROVED" | "REJECTED",
    actor: PurchaseOrderActor,
    correlationId: string,
    reason?: string,
  ): Promise<PurchaseOrderCreated> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; approval_request_id: string | null; number: string }[]>`
        SELECT status, approval_request_id, number FROM purchase_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = locked[0];
      if (!order) throw new PurchaseOrderError("ORDER_NOT_FOUND", "Purchase order not found");
      if (order.status !== "PENDING_APPROVAL" || !order.approval_request_id) {
        throw new PurchaseOrderError("NOT_PENDING_APPROVAL", "This order is not waiting for approval");
      }
      await this.approvals.decide(tx, order.approval_request_id, decision, actor.id, new Date(), reason);
      await tx.purchaseOrder.update({ where: { id }, data: { status: decision, version: { increment: 1 } } });
      return { id, number: order.number, status: decision } as const;
    });
    await this.audit.log({
      actorId: actor.id,
      action: decision === "APPROVED" ? "purchase_order.approved" : "purchase_order.rejected",
      entityType: "PurchaseOrder",
      entityId: id,
      after: { ...result },
      correlationId,
    });
    return result;
  }

  async cancel(id: string, actor: PurchaseOrderActor, correlationId: string): Promise<PurchaseOrderCreated> {
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; approval_request_id: string | null; number: string }[]>`
        SELECT status, approval_request_id, number FROM purchase_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = locked[0];
      if (!order) throw new PurchaseOrderError("ORDER_NOT_FOUND", "Purchase order not found");
      // Only an order nothing has been received against can be cancelled — once goods are in, the
      // receipt is in the ledger and the order is closed by receiving or by a correction document.
      if (order.status !== "PENDING_APPROVAL" && order.status !== "APPROVED") {
        throw new PurchaseOrderError("NOT_CANCELLABLE", "This order can no longer be cancelled");
      }
      if (order.status === "PENDING_APPROVAL" && order.approval_request_id) {
        await this.approvals.decide(tx, order.approval_request_id, "REJECTED", actor.id, new Date(), "Order cancelled");
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", version: { increment: 1 } } });
      return { id, number: order.number, status: "CANCELLED" } as const;
    });
    await this.audit.log({ actorId: actor.id, action: "purchase_order.cancelled", entityType: "PurchaseOrder", entityId: id, after: { ...result }, correlationId });
    return result;
  }
}
