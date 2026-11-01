import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "../inventory/account-mapping.service.js";
import { lockStockRow, saveStockRow } from "../inventory/stock-row.repo.js";
import { InsufficientStockError, applyIssue } from "../inventory/weighted-average.util.js";

export class GoodsReturnError extends Error {
  constructor(
    readonly code:
      | "ORDER_NOT_FOUND"
      | "ORDER_NOT_RETURNABLE"
      | "WAREHOUSE_NOT_FOUND"
      | "LINE_NOT_ON_ORDER"
      | "OVER_RETURN"
      | "INSUFFICIENT_STOCK"
      | "NO_OPEN_PERIOD"
      | "EMPTY_RETURN",
    message: string,
  ) {
    super(message);
    this.name = "GoodsReturnError";
  }
}

export interface GoodsReturnLineInput {
  readonly purchaseOrderLineId: string;
  readonly quantity: string;
}

export interface CreateGoodsReturnInput {
  readonly purchaseOrderId: string;
  readonly warehouseId: string;
  readonly documentDate: Date;
  readonly reference?: string | undefined;
  readonly reason?: string | undefined;
  readonly lines: readonly GoodsReturnLineInput[];
}

export interface GoodsReturnActor {
  readonly id: string;
  readonly companyId: string;
}

export interface GoodsReturnResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly orderStatus: "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED";
}

export interface GoodsReturnLineSummary {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly quantity: string;
  readonly unitCost: string;
  readonly value: string;
}

export interface GoodsReturnSummary {
  readonly id: string;
  readonly number: string;
  readonly documentDate: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderNumber: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly currency: string;
  // Sum of what left stock (the Inventory credit).
  readonly totalValue: string;
  readonly lines: readonly GoodsReturnLineSummary[];
}

export interface GoodsReturnListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly purchaseOrderId?: string | undefined;
}

export interface GoodsReturnListPage {
  readonly data: readonly GoodsReturnSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Sends goods that were received against an order back to the supplier, BEFORE the supplier invoice
// has been matched to them (docs/01-OPEN-DECISIONS.md section D9: sending back invoiced goods is not built;
// the debit note of D8 corrects only the amount owed and never moves stock). The posting reverses the receipt:
//   GRNI      debit   quantity x ORDER price   (exactly what the receipt credited to GRNI)
//   Inventory credit  value taken out of stock at the WEIGHTED-AVERAGE cost (keeps the Inventory
//                     control account equal to the sum of stock values, docs/05 §7)
//   Purchase price variance takes the difference, if the two ever differ.
// Everything — stock, order counters, document, movements and the journal entry — commits in one
// transaction under a row lock on the order, so two people cannot return, receive or invoice the
// same quantity twice.
export class GoodsReturnService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async create(
    input: CreateGoodsReturnInput,
    actor: GoodsReturnActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<GoodsReturnResult> {
    if (input.lines.length === 0) throw new GoodsReturnError("EMPTY_RETURN", "Choose at least one line to return");

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; supplier_id: string }[]>`
        SELECT status, supplier_id FROM purchase_orders WHERE id = ${input.purchaseOrderId} AND company_id = ${actor.companyId} FOR UPDATE
      `;
      const order = locked[0];
      if (!order) throw new GoodsReturnError("ORDER_NOT_FOUND", "Purchase order not found");
      if (order.status !== "PARTIALLY_RECEIVED" && order.status !== "RECEIVED") {
        throw new GoodsReturnError("ORDER_NOT_RETURNABLE", "Goods can only be returned against an order that has received goods");
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, companyId: actor.companyId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new GoodsReturnError("WAREHOUSE_NOT_FOUND", "Warehouse not found");

      const orderLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: input.purchaseOrderId } });
      const byId = new Map(orderLines.map((l) => [l.id, l]));

      // The same order line may appear twice in one request; the bound applies to the sum.
      const requested = new Map<string, Prisma.Decimal>();
      for (const line of input.lines) {
        if (!byId.has(line.purchaseOrderLineId)) throw new GoodsReturnError("LINE_NOT_ON_ORDER", "A line does not belong to this order");
        const quantity = new Prisma.Decimal(line.quantity);
        requested.set(line.purchaseOrderLineId, (requested.get(line.purchaseOrderLineId) ?? new Prisma.Decimal(0)).plus(quantity));
      }
      for (const [lineId, quantity] of requested) {
        const orderLine = byId.get(lineId)!;
        // Only goods not yet matched to a supplier invoice can go back this way.
        if (quantity.greaterThan(orderLine.receivedQuantity.minus(orderLine.invoicedQuantity))) {
          throw new GoodsReturnError(
            "OVER_RETURN",
            "Cannot return more than was received and not yet invoiced; returning invoiced goods is not supported yet",
          );
        }
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.documentDate);
      if (!period) throw new GoodsReturnError("NO_OPEN_PERIOD", "No open fiscal period covers this document date");
      const currency = await companyCurrency(tx, actor.companyId);
      const inventoryAccountId = await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY");
      const grniAccountId = await this.accountMappings.resolve(tx, actor.companyId, "GRNI");

      // Apply every line to its stock row before posting anything, so a problem in line 3 rolls back
      // lines 1-2 as well. Item order is fixed so two concurrent returns lock rows in the same order.
      const ordered = [...requested.entries()].sort(([a], [b]) => {
        const itemA = byId.get(a)!.itemId;
        const itemB = byId.get(b)!.itemId;
        return itemA < itemB ? -1 : itemA > itemB ? 1 : 0;
      });
      let totalValue = new Prisma.Decimal(0);
      let totalOrderValue = new Prisma.Decimal(0);
      const lineRecords: {
        itemId: string;
        purchaseOrderLineId: string;
        quantity: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        value: Prisma.Decimal;
        orderValue: Prisma.Decimal;
      }[] = [];
      for (const [lineId, quantity] of ordered) {
        const orderLine = byId.get(lineId)!;
        const stock = await lockStockRow(tx, actor.companyId, orderLine.itemId, input.warehouseId);
        let issued;
        try {
          issued = applyIssue(stock.state, quantity);
        } catch (error) {
          if (error instanceof InsufficientStockError) throw new GoodsReturnError("INSUFFICIENT_STOCK", error.message);
          throw error;
        }
        await saveStockRow(tx, stock.id, issued.state);

        const orderValue = quantity.times(orderLine.unitPrice).toDecimalPlaces(4);
        totalValue = totalValue.plus(issued.value);
        totalOrderValue = totalOrderValue.plus(orderValue);
        lineRecords.push({
          itemId: orderLine.itemId,
          purchaseOrderLineId: lineId,
          quantity,
          unitCost: issued.unitCost,
          value: issued.value,
          orderValue,
        });
      }

      // REVIEW: the difference between what the receipt booked to GRNI (order price) and the
      // weighted-average cost taken out of stock goes to purchase price variance, the same account the
      // supplier-invoice price difference uses (D1). Without it GRNI would keep a residue that no
      // invoice can ever clear. An accountant should confirm this treatment (section D9).
      const variance = totalOrderValue.minus(totalValue);
      const journalLines: { accountId: string; debit?: string; credit?: string; description: string }[] = [];
      if (totalOrderValue.greaterThan(0)) {
        journalLines.push({ accountId: grniAccountId, debit: totalOrderValue.toFixed(4), description: "Goods return" });
      }
      if (totalValue.greaterThan(0)) {
        journalLines.push({ accountId: inventoryAccountId, credit: totalValue.toFixed(4), description: "Goods return" });
      }
      if (!variance.isZero()) {
        const varianceAccountId = await this.accountMappings.resolve(tx, actor.companyId, "PURCHASE_PRICE_VARIANCE");
        journalLines.push(
          variance.greaterThan(0)
            ? { accountId: varianceAccountId, credit: variance.toFixed(4), description: "Goods return — cost difference" }
            : { accountId: varianceAccountId, debit: variance.abs().toFixed(4), description: "Goods return — cost difference" },
        );
      }

      const returnId = newId();
      const posting = await this.engine.postEntry(
        {
          companyId: actor.companyId,
          fiscalPeriodId: period.id,
          entryDate: input.documentDate,
          postingDate: input.documentDate,
          currency,
          lines: journalLines,
          sourceModule: "purchasing",
          sourceDocumentType: "goods_return",
          sourceDocumentId: returnId,
          actorId: actor.id,
          correlationId,
          idempotencyKey,
        },
        tx,
      );

      await tx.goodsReturn.create({
        data: {
          id: returnId,
          companyId: actor.companyId,
          number: posting.number,
          warehouseId: input.warehouseId,
          partyId: order.supplier_id,
          purchaseOrderId: input.purchaseOrderId,
          documentDate: input.documentDate,
          reference: input.reference ?? null,
          reason: input.reason ?? null,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
          lines: {
            create: lineRecords.map((l, index) => ({
              id: newId(),
              itemId: l.itemId,
              purchaseOrderLineId: l.purchaseOrderLineId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              value: l.value,
              orderValue: l.orderValue,
              lineNumber: index + 1,
            })),
          },
        },
      });

      await tx.stockMovement.createMany({
        data: lineRecords.map((l) => ({
          id: newId(),
          companyId: actor.companyId,
          itemId: l.itemId,
          warehouseId: input.warehouseId,
          movementType: "RETURN",
          quantity: l.quantity.negated(),
          unitCost: l.unitCost,
          value: l.value,
          sourceDocumentType: "goods_return",
          sourceDocumentId: returnId,
          journalEntryId: posting.journalEntryId,
          actorId: actor.id,
          correlationId,
        })),
      });

      // The returned quantity is no longer received: it can be received again, and the order status
      // follows the counters (the database backstops 0 <= invoiced <= received <= ordered).
      let allReceived = true;
      let anyReceived = false;
      for (const orderLine of orderLines) {
        const returned = requested.get(orderLine.id) ?? new Prisma.Decimal(0);
        const received = orderLine.receivedQuantity.minus(returned);
        if (returned.greaterThan(0)) {
          await tx.purchaseOrderLine.update({ where: { id: orderLine.id }, data: { receivedQuantity: received } });
        }
        if (received.lessThan(orderLine.quantity)) allReceived = false;
        if (received.greaterThan(0)) anyReceived = true;
      }
      const orderStatus = allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "APPROVED";
      await tx.purchaseOrder.update({ where: { id: input.purchaseOrderId }, data: { status: orderStatus, version: { increment: 1 } } });

      return { id: returnId, number: posting.number, journalEntryId: posting.journalEntryId, orderStatus } as const;
    });

    await this.audit.log({
      actorId: actor.id,
      action: "goods_return.posted",
      entityType: "GoodsReturn",
      entityId: result.id,
      after: { ...result, purchaseOrderId: input.purchaseOrderId },
      correlationId,
    });
    return result;
  }

  async list(companyId: string, query: GoodsReturnListQuery): Promise<GoodsReturnListPage> {
    const parsed = Number.parseInt(query.limit ?? "", 10);
    const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT, MAX_LIMIT);
    const rows = await this.prisma.goodsReturn.findMany({
      where: { companyId, ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}) },
      orderBy: [{ documentDate: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        party: { select: { name: true, nameAr: true } },
        warehouse: { select: { name: true, nameAr: true } },
        purchaseOrder: { select: { number: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { item: { select: { code: true, name: true, nameAr: true } } } },
      },
    });
    if (rows.length === 0) return { data: [], pageInfo: { hasMore: false, nextCursor: null } };
    const currency = await this.prisma.company
      .findUniqueOrThrow({ where: { id: companyId }, select: { defaultCurrency: true } })
      .then((c) => c.defaultCurrency);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data: GoodsReturnSummary[] = page.map((r) => ({
      id: r.id,
      number: r.number,
      documentDate: r.documentDate.toISOString().slice(0, 10),
      purchaseOrderId: r.purchaseOrderId,
      purchaseOrderNumber: r.purchaseOrder.number,
      supplierId: r.partyId,
      supplierName: r.party.name,
      supplierNameAr: r.party.nameAr,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouse.name,
      warehouseNameAr: r.warehouse.nameAr,
      reference: r.reference,
      reason: r.reason,
      currency,
      totalValue: r.lines.reduce((sum, l) => sum.plus(l.value), new Prisma.Decimal(0)).toFixed(4),
      lines: r.lines.map((l) => ({
        itemId: l.itemId,
        itemCode: l.item.code,
        itemName: l.item.name,
        itemNameAr: l.item.nameAr,
        quantity: l.quantity.toFixed(4),
        unitCost: l.unitCost.toFixed(4),
        value: l.value.toFixed(4),
      })),
    }));
    return { data, pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }
}
