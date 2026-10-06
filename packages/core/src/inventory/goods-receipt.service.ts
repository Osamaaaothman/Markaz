import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, TransactionClient } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "./account-mapping.service.js";
import { lockStockRow, saveStockRow } from "./stock-row.repo.js";
import { applyReceipt } from "./weighted-average.util.js";

export class GoodsReceiptError extends Error {
  constructor(
    readonly code: "WAREHOUSE_NOT_FOUND" | "ITEM_NOT_FOUND" | "NO_OPEN_PERIOD" | "EMPTY_RECEIPT",
    message: string,
  ) {
    super(message);
    this.name = "GoodsReceiptError";
  }
}

export interface GoodsReceiptLineInput {
  readonly itemId: string;
  readonly quantity: string;
  readonly unitCost: string;
  // Set by purchasing when this quantity is received against an order line (M5). The receipt
  // only records the link; the order's own bookkeeping belongs to the purchasing service.
  readonly purchaseOrderLineId?: string | undefined;
}

export interface CreateGoodsReceiptInput {
  readonly warehouseId: string;
  readonly partyId?: string | undefined;
  readonly purchaseOrderId?: string | undefined;
  readonly documentDate: Date;
  readonly reference?: string | undefined;
  readonly lines: readonly GoodsReceiptLineInput[];
}

export interface GoodsReceiptActor {
  readonly id: string;
  readonly companyId: string;
}

export interface GoodsReceiptResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
}

// A receipt not yet matched to a supplier invoice: Inventory increases, GRN-Payables (goods
// received, not yet invoiced) increases by the same amount — docs/14-MILESTONES.md M4 decision.
// Known gap: unlike journal entries, a retried call with the same Idempotency-Key is not
// replayed at the document level — it is protected from double-POSTING (the engine's own
// idempotencyKey still guards the ledger), but a retry errors on the receipt number's unique
// constraint instead of returning the original receipt. Acceptable for M4; revisit if this
// becomes a real operational papercut.
export class GoodsReceiptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async create(
    input: CreateGoodsReceiptInput,
    actor: GoodsReceiptActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<GoodsReceiptResult> {
    const result = await this.prisma.$transaction((tx) => this.createIn(tx, input, actor, correlationId, idempotencyKey));
    await this.auditPosted(result, actor, correlationId);
    return result;
  }

  // The same posting, inside a transaction the caller already holds — purchasing receives against
  // an order in one transaction with the order's own counters (docs/02 §5: document, movement,
  // entry and counters commit together or not at all). The caller audits after it commits.
  async createIn(
    tx: TransactionClient,
    input: CreateGoodsReceiptInput,
    actor: GoodsReceiptActor,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<GoodsReceiptResult> {
    if (input.lines.length === 0) {
      throw new GoodsReceiptError("EMPTY_RECEIPT", "A goods receipt needs at least one line");
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, companyId: actor.companyId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) throw new GoodsReceiptError("WAREHOUSE_NOT_FOUND", "Warehouse not found");

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId: actor.companyId, isActive: true } });
    const itemsById = new Map(items.map((i) => [i.id, i]));
    for (const itemId of itemIds) {
      if (!itemsById.has(itemId)) throw new GoodsReceiptError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
    }

    const period = await findOpenFiscalPeriod(tx, actor.companyId, input.documentDate);
    if (!period) throw new GoodsReceiptError("NO_OPEN_PERIOD", "No open fiscal period covers this document date");
    const currency = await companyCurrency(tx, actor.companyId);

    const inventoryAccountId = await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY");
    const grniAccountId = await this.accountMappings.resolve(tx, actor.companyId, "GRNI");

    // Apply every line's receipt to its stock row before posting anything, so a problem in
    // line 3 rolls back lines 1-2 as well — one document, one unit of work.
    let totalValue = new Prisma.Decimal(0);
    const lineRecords: {
      itemId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      value: Prisma.Decimal;
      purchaseOrderLineId: string | null;
    }[] = [];
    for (const line of input.lines) {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitCost = new Prisma.Decimal(line.unitCost);
      const stock = await lockStockRow(tx, actor.companyId, line.itemId, input.warehouseId);
      const newState = applyReceipt(stock.state, quantity, unitCost);
      await saveStockRow(tx, stock.id, newState);

      const value = quantity.times(unitCost).toDecimalPlaces(4);
      totalValue = totalValue.plus(value);
      lineRecords.push({ itemId: line.itemId, quantity, unitCost, value, purchaseOrderLineId: line.purchaseOrderLineId ?? null });
    }

    const receiptId = newId();
    const posting = await this.engine.postEntry(
      {
        companyId: actor.companyId,
        fiscalPeriodId: period.id,
        entryDate: input.documentDate,
        postingDate: input.documentDate,
        currency,
        lines: [
          { accountId: inventoryAccountId, debit: totalValue.toFixed(4), description: "Goods receipt" },
          { accountId: grniAccountId, credit: totalValue.toFixed(4), description: "Goods receipt" },
        ],
        sourceModule: "inventory",
        sourceDocumentType: "goods_receipt",
        sourceDocumentId: receiptId,
        actorId: actor.id,
        correlationId,
        idempotencyKey,
      },
      tx,
    );

    const number = posting.number;
    await tx.goodsReceipt.create({
      data: {
        id: receiptId,
        companyId: actor.companyId,
        number,
        warehouseId: input.warehouseId,
        partyId: input.partyId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        documentDate: input.documentDate,
        reference: input.reference ?? null,
        journalEntryId: posting.journalEntryId,
        actorId: actor.id,
        correlationId,
        lines: {
          create: lineRecords.map((l, index) => ({
            id: newId(),
            itemId: l.itemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            value: l.value,
            lineNumber: index + 1,
            purchaseOrderLineId: l.purchaseOrderLineId,
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
        movementType: "RECEIPT",
        quantity: l.quantity,
        unitCost: l.unitCost,
        value: l.value,
        sourceDocumentType: "goods_receipt",
        sourceDocumentId: receiptId,
        journalEntryId: posting.journalEntryId,
        actorId: actor.id,
        correlationId,
      })),
    });

    await tx.costLayer.createMany({
      data: lineRecords.map((l) => ({
        id: newId(),
        companyId: actor.companyId,
        itemId: l.itemId,
        warehouseId: input.warehouseId,
        receivedAt: input.documentDate,
        quantityReceived: l.quantity,
        quantityRemaining: l.quantity,
        unitCost: l.unitCost,
        sourceDocumentId: receiptId,
      })),
    });

    return { id: receiptId, number, journalEntryId: posting.journalEntryId };
  }

  async auditPosted(result: GoodsReceiptResult, actor: GoodsReceiptActor, correlationId: string): Promise<void> {
    await this.audit.log({
      actorId: actor.id,
      action: "goods_receipt.posted",
      entityType: "GoodsReceipt",
      entityId: result.id,
      after: { ...result },
      correlationId,
    });
  }
}
