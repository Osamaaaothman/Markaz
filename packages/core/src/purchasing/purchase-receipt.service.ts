import { Prisma, type PrismaClient } from "@erp/db";
import type { IAuditLogger } from "../contracts.js";
import { GoodsReceiptService, type GoodsReceiptResult } from "../inventory/goods-receipt.service.js";

export class PurchaseReceiptError extends Error {
  constructor(
    readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_RECEIVABLE" | "LINE_NOT_ON_ORDER" | "OVER_RECEIPT" | "EMPTY_RECEIPT",
    message: string,
  ) {
    super(message);
    this.name = "PurchaseReceiptError";
  }
}

export interface ReceiveAgainstOrderLine {
  readonly purchaseOrderLineId: string;
  readonly quantity: string;
}

export interface ReceiveAgainstOrderInput {
  readonly warehouseId: string;
  readonly documentDate: Date;
  readonly reference?: string | undefined;
  readonly lines: readonly ReceiveAgainstOrderLine[];
}

export interface PurchaseReceiptActor {
  readonly id: string;
  readonly companyId: string;
}

export interface PurchaseReceiptResult extends GoodsReceiptResult {
  readonly orderStatus: "PARTIALLY_RECEIVED" | "RECEIVED";
}

// Books goods against an approved order. The receipt is the M4 goods receipt (Inventory / GRNI at
// the order price); this service adds the order side — the status gate, the "never more than
// ordered" bound, the per-line received counters and the order status — all in one transaction
// with the receipt, under a row lock on the order so two people receiving at once cannot both
// take the last unit of the quantity.
export class PurchaseReceiptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly goodsReceipts: GoodsReceiptService,
    private readonly audit: IAuditLogger,
  ) {}

  async receive(
    orderId: string,
    input: ReceiveAgainstOrderInput,
    actor: PurchaseReceiptActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<PurchaseReceiptResult> {
    if (input.lines.length === 0) throw new PurchaseReceiptError("EMPTY_RECEIPT", "Choose at least one line to receive");

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; supplier_id: string }[]>`
        SELECT status, supplier_id FROM purchase_orders WHERE id = ${orderId} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = locked[0];
      if (!order) throw new PurchaseReceiptError("ORDER_NOT_FOUND", "Purchase order not found");
      if (order.status !== "APPROVED" && order.status !== "PARTIALLY_RECEIVED") {
        throw new PurchaseReceiptError("ORDER_NOT_RECEIVABLE", "Goods can only be received against an approved order");
      }

      const orderLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: orderId } });
      const byId = new Map(orderLines.map((l) => [l.id, l]));

      // The same order line may appear twice in one request; the bound applies to the sum.
      const requested = new Map<string, Prisma.Decimal>();
      for (const line of input.lines) {
        if (!byId.has(line.purchaseOrderLineId)) throw new PurchaseReceiptError("LINE_NOT_ON_ORDER", "A line does not belong to this order");
        const quantity = new Prisma.Decimal(line.quantity);
        requested.set(line.purchaseOrderLineId, (requested.get(line.purchaseOrderLineId) ?? new Prisma.Decimal(0)).plus(quantity));
      }
      for (const [lineId, quantity] of requested) {
        const orderLine = byId.get(lineId)!;
        if (quantity.greaterThan(orderLine.quantity.minus(orderLine.receivedQuantity))) {
          throw new PurchaseReceiptError("OVER_RECEIPT", "Cannot receive more than the quantity still outstanding on the order");
        }
      }

      const receipt = await this.goodsReceipts.createIn(
        tx,
        {
          warehouseId: input.warehouseId,
          partyId: order.supplier_id,
          purchaseOrderId: orderId,
          documentDate: input.documentDate,
          reference: input.reference,
          lines: input.lines.map((l) => {
            const orderLine = byId.get(l.purchaseOrderLineId)!;
            // Valued at the agreed order price — the supplier invoice is matched against it later.
            return {
              itemId: orderLine.itemId,
              quantity: l.quantity,
              unitCost: orderLine.unitPrice.toFixed(4),
              purchaseOrderLineId: orderLine.id,
            };
          }),
        },
        actor,
        correlationId,
        idempotencyKey,
      );

      let allReceived = true;
      for (const orderLine of orderLines) {
        const added = requested.get(orderLine.id) ?? new Prisma.Decimal(0);
        const received = orderLine.receivedQuantity.plus(added);
        if (added.greaterThan(0)) {
          await tx.purchaseOrderLine.update({ where: { id: orderLine.id }, data: { receivedQuantity: received } });
        }
        if (received.lessThan(orderLine.quantity)) allReceived = false;
      }
      const orderStatus = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: orderStatus, version: { increment: 1 } } });

      return { ...receipt, orderStatus } as const;
    });

    await this.goodsReceipts.auditPosted(result, actor, correlationId);
    await this.audit.log({
      actorId: actor.id,
      action: "purchase_order.received",
      entityType: "PurchaseOrder",
      entityId: orderId,
      after: { goodsReceiptId: result.id, goodsReceiptNumber: result.number, orderStatus: result.orderStatus },
      correlationId,
    });
    return result;
  }
}
