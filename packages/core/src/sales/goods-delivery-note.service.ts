import { lockSubmission } from "../documents/submission-lock.js";
import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { fiscalYearKeyFor } from "../accounting/fiscal-period.util.js";
import { allocateDocumentNumber } from "../reference.js";
import { blankToNull, dateOnly, lockCustomer } from "./sales-lines.js";
import type { SalesActor } from "./quotation.service.js";

// A storekeeper's handover record, printed before the sales invoice: no prices, no amounts, no
// stock movement and no journal entry (docs/01-OPEN-DECISIONS.md E1 still holds — stock leaves
// and COGS posts only when the invoice is created). An order may have several delivery notes
// covering it in part; deliveredQuantity on the order line is the running total.
export class GoodsDeliveryNoteError extends Error {
  constructor(
    readonly code:
      | "ORDER_NOT_FOUND"
      | "ORDER_CANCELLED"
      | "LINE_NOT_ON_ORDER"
      | "OVER_DELIVERY"
      | "EMPTY_DELIVERY"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "GoodsDeliveryNoteError";
  }
}

export interface GoodsDeliveryNoteLineInput {
  readonly salesOrderLineId: string;
  readonly quantity: string;
  // Defaults to the order line's own description when omitted.
  readonly description?: string | undefined;
}

export interface CreateGoodsDeliveryNoteInput {
  readonly salesOrderId: string;
  readonly deliveryDate: Date;
  readonly driverName?: string | undefined;
  readonly receiverName?: string | undefined;
  readonly notes?: string | undefined;
  readonly lines: readonly GoodsDeliveryNoteLineInput[];
}

export interface GoodsDeliveryNoteLineView {
  readonly id: string;
  readonly salesOrderLineId: string;
  readonly itemId: string | null;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly itemNameAr: string | null;
  readonly description: string;
  readonly quantity: string;
}

export interface GoodsDeliveryNoteSummary {
  readonly id: string;
  readonly number: string;
  readonly salesOrderId: string;
  readonly salesOrderNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly deliveryDate: string;
  readonly driverName: string | null;
  readonly receiverName: string | null;
  readonly lineCount: number;
}

export interface GoodsDeliveryNoteDetail extends GoodsDeliveryNoteSummary {
  readonly notes: string | null;
  readonly createdBy: string;
  readonly lines: readonly GoodsDeliveryNoteLineView[];
}

export interface GoodsDeliveryNoteListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly salesOrderId?: string | undefined;
}

export interface GoodsDeliveryNoteListPage {
  readonly data: readonly GoodsDeliveryNoteSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface GoodsDeliveryNoteCreated {
  readonly id: string;
  readonly number: string;
}

const DETAIL_INCLUDE = {
  customer: true,
  salesOrder: { select: { number: true } },
  lines: { orderBy: { lineNumber: "asc" as const }, include: { item: { select: { code: true, name: true, nameAr: true } } } },
} as const;

type NoteRow = Prisma.GoodsDeliveryNoteGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toSummary(row: NoteRow): GoodsDeliveryNoteSummary {
  return {
    id: row.id,
    number: row.number,
    salesOrderId: row.salesOrderId,
    salesOrderNumber: row.salesOrder.number,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerNameAr: row.customer.nameAr,
    deliveryDate: dateOnly(row.deliveryDate),
    driverName: row.driverName,
    receiverName: row.receiverName,
    lineCount: row.lines.length,
  };
}

function toDetail(row: NoteRow): GoodsDeliveryNoteDetail {
  return {
    ...toSummary(row),
    notes: row.notes,
    createdBy: row.createdBy,
    lines: row.lines.map((line) => ({
      id: line.id,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      itemCode: line.item?.code ?? null,
      itemName: line.item?.name ?? null,
      itemNameAr: line.item?.nameAr ?? null,
      description: line.description,
      quantity: line.quantity.toFixed(4),
    })),
  };
}

export class GoodsDeliveryNoteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async create(
    input: CreateGoodsDeliveryNoteInput,
    actor: SalesActor,
    correlationId: string,
    submissionKey?: string,
  ): Promise<GoodsDeliveryNoteCreated> {
    if (input.lines.length === 0) throw new GoodsDeliveryNoteError("EMPTY_DELIVERY", "Choose at least one line to deliver");

    let replay = false;
    const created = await this.prisma.$transaction(async (tx) => {
      await lockSubmission(tx, actor.companyId, "goods_delivery_note", submissionKey);
      if (submissionKey) {
        const existing = await tx.goodsDeliveryNote.findFirst({ where: { companyId: actor.companyId, submissionKey } });
        if (existing) { replay = true; return { id: existing.id, number: existing.number }; }
      }

      const locked = await tx.$queryRaw<{ status: string; customer_id: string }[]>`
        SELECT status, customer_id FROM sales_orders WHERE id = ${input.salesOrderId} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = locked[0];
      if (!order) throw new GoodsDeliveryNoteError("ORDER_NOT_FOUND", "Sales order not found");
      if (order.status === "CANCELLED") throw new GoodsDeliveryNoteError("ORDER_CANCELLED", "Cannot deliver against a cancelled order");
      await lockCustomer(tx, actor.companyId, order.customer_id);

      const orderLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: input.salesOrderId } });
      const byId = new Map(orderLines.map((l) => [l.id, l]));

      // The same order line may appear twice in one note; the bound applies to the sum.
      const requested = new Map<string, Prisma.Decimal>();
      for (const line of input.lines) {
        if (!byId.has(line.salesOrderLineId)) throw new GoodsDeliveryNoteError("LINE_NOT_ON_ORDER", "A line does not belong to this order");
        const quantity = new Prisma.Decimal(line.quantity);
        requested.set(line.salesOrderLineId, (requested.get(line.salesOrderLineId) ?? new Prisma.Decimal(0)).plus(quantity));
      }
      for (const [lineId, quantity] of requested) {
        const orderLine = byId.get(lineId)!;
        if (quantity.lessThanOrEqualTo(0) || quantity.greaterThan(orderLine.quantity.minus(orderLine.deliveredQuantity))) {
          throw new GoodsDeliveryNoteError("OVER_DELIVERY", "Cannot deliver more than the quantity still outstanding on the order");
        }
      }

      const fiscalYear = await fiscalYearKeyFor(tx, actor.companyId, input.deliveryDate);
      const number = await allocateDocumentNumber(tx, actor.companyId, "goods_delivery_note", "DN", fiscalYear);
      const id = newId();

      await tx.goodsDeliveryNote.create({
        data: {
          id,
          submissionKey: submissionKey ?? null,
          companyId: actor.companyId,
          number,
          salesOrderId: input.salesOrderId,
          customerId: order.customer_id,
          deliveryDate: input.deliveryDate,
          driverName: blankToNull(input.driverName),
          receiverName: blankToNull(input.receiverName),
          notes: blankToNull(input.notes),
          createdBy: actor.id,
          correlationId,
          lines: {
            create: input.lines.map((line, index) => {
              const orderLine = byId.get(line.salesOrderLineId)!;
              return {
                id: newId(),
                salesOrderLineId: orderLine.id,
                itemId: orderLine.itemId,
                description: blankToNull(line.description) ?? orderLine.description,
                quantity: line.quantity,
                lineNumber: index + 1,
              };
            }),
          },
        },
      });

      for (const [lineId, quantity] of requested) {
        const orderLine = byId.get(lineId)!;
        await tx.salesOrderLine.update({ where: { id: lineId }, data: { deliveredQuantity: orderLine.deliveredQuantity.plus(quantity) } });
      }

      return { id, number };
    });

    if (!replay) {
      await this.audit.log({
        actorId: actor.id,
        action: "goods_delivery_note.created",
        entityType: "GoodsDeliveryNote",
        entityId: created.id,
        after: { ...created, salesOrderId: input.salesOrderId },
        correlationId,
      });
    }
    return created;
  }

  async getById(id: string, companyId: string): Promise<GoodsDeliveryNoteDetail> {
    const row = await this.prisma.goodsDeliveryNote.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE });
    if (!row) throw new GoodsDeliveryNoteError("NOT_FOUND", "Delivery note not found");
    return toDetail(row);
  }

  async list(companyId: string, query: GoodsDeliveryNoteListQuery): Promise<GoodsDeliveryNoteListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const rows = await this.prisma.goodsDeliveryNote.findMany({
      where: { companyId, ...(query.salesOrderId ? { salesOrderId: query.salesOrderId } : {}) },
      include: DETAIL_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map(toSummary),
      pageInfo: { hasMore, nextCursor: hasMore ? page[page.length - 1]!.id : null },
    };
  }
}
