import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAccountingEngine, IAuditLogger, INumberingService } from "../contracts.js";
import { companyCurrency } from "../accounting/company-currency.util.js";
import { findOpenFiscalPeriod } from "../accounting/fiscal-period.util.js";
import { AccountMappingService } from "./account-mapping.service.js";
import { lockStockRow, saveStockRow } from "./stock-row.repo.js";
import { applyCountAdjustment, averageUnitCost } from "./weighted-average.util.js";

export class StockCountError extends Error {
  constructor(
    readonly code:
      | "WAREHOUSE_NOT_FOUND"
      | "ITEM_NOT_FOUND"
      | "EMPTY_COUNT"
      | "UNIT_COST_REQUIRED"
      | "COUNT_NOT_FOUND"
      | "ALREADY_POSTED"
      | "NO_OPEN_PERIOD",
    message: string,
  ) {
    super(message);
    this.name = "StockCountError";
  }
}

export interface StockCountLineInput {
  readonly itemId: string;
  readonly countedQuantity: string;
  // Required only when nothing is on hand for this item right now — there is no average cost
  // to fall back on (docs/14 M4 decision: "a cost must be entered if stock was 0").
  readonly unitCostIfNoStock?: string | undefined;
}

export interface RecordStockCountInput {
  readonly warehouseId: string;
  readonly documentDate: Date;
  readonly lines: readonly StockCountLineInput[];
}

export interface StockCountActor {
  readonly id: string;
  readonly companyId: string;
}

export interface StockCountRecordResult {
  readonly id: string;
  readonly number: string;
}

export interface StockCountPostResult {
  readonly id: string;
  // null when every line matched the books exactly — nothing needed posting.
  readonly journalEntryId: string | null;
}

export interface StockCountSummary {
  readonly id: string;
  readonly number: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly documentDate: string;
  readonly isPosted: boolean;
  readonly lineCount: number;
}

export interface StockCountListQuery {
  readonly warehouseId?: string | undefined;
  readonly unpostedOnly?: "true" | "false" | undefined;
}

// A physical count entered as a draft (this is the one M4 document that is not posted at the
// moment it is created — docs/14 M4), then posted as a separate step once every line has been
// counted. `unitCost` is captured once, at record time, and reused unchanged at posting
// (docs/04-DATA-MODEL-RULES.md §2: stored, never recomputed). The variance quantity used for
// the actual posting, though, is computed against stock's state AT POSTING TIME, not the
// record-time snapshot — a physical count says "there are exactly N units right now," and
// that must hold even if other movements happened while the count was still a draft; the
// stored systemQuantity column stays purely informational (what was expected when counting
// started), not fed into the posting math.
export class StockCountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: IAccountingEngine,
    private readonly numbering: INumberingService,
    private readonly accountMappings: AccountMappingService,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: StockCountListQuery): Promise<StockCountSummary[]> {
    const counts = await this.prisma.stockCount.findMany({
      where: {
        companyId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.unpostedOnly === "true" ? { postedAt: null } : {}),
      },
      include: { warehouse: { select: { name: true } }, _count: { select: { lines: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return counts.map((c) => ({
      id: c.id,
      number: c.number,
      warehouseId: c.warehouseId,
      warehouseName: c.warehouse.name,
      documentDate: c.documentDate.toISOString(),
      isPosted: c.postedAt !== null,
      lineCount: c._count.lines,
    }));
  }

  async record(input: RecordStockCountInput, actor: StockCountActor, correlationId: string): Promise<StockCountRecordResult> {
    if (input.lines.length === 0) {
      throw new StockCountError("EMPTY_COUNT", "A stock count needs at least one line");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, companyId: actor.companyId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new StockCountError("WAREHOUSE_NOT_FOUND", "Warehouse not found");

      const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId: actor.companyId, isActive: true } });
      const itemsById = new Map(items.map((i) => [i.id, i]));
      for (const itemId of itemIds) {
        if (!itemsById.has(itemId)) throw new StockCountError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
      }

      const period = await findOpenFiscalPeriod(tx, actor.companyId, input.documentDate);
      if (!period) throw new StockCountError("NO_OPEN_PERIOD", "No open fiscal period covers this document date");

      const lineRecords: { itemId: string; systemQuantity: Prisma.Decimal; countedQuantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
      for (const line of input.lines) {
        const stockRow = await tx.itemWarehouseStock.findUnique({
          where: { itemId_warehouseId: { itemId: line.itemId, warehouseId: input.warehouseId } },
          select: { quantity: true, value: true },
        });
        const state = stockRow
          ? { quantity: stockRow.quantity, value: stockRow.value }
          : { quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) };

        let unitCost: Prisma.Decimal;
        if (state.quantity.greaterThan(0)) {
          unitCost = averageUnitCost(state);
        } else if (line.unitCostIfNoStock !== undefined) {
          unitCost = new Prisma.Decimal(line.unitCostIfNoStock);
        } else {
          throw new StockCountError(
            "UNIT_COST_REQUIRED",
            `Item ${line.itemId} has nothing on hand — a unit cost is required to record a count for it`,
          );
        }

        lineRecords.push({
          itemId: line.itemId,
          systemQuantity: state.quantity,
          countedQuantity: new Prisma.Decimal(line.countedQuantity),
          unitCost,
        });
      }

      const number = await this.numbering.next("stock_count", { companyId: actor.companyId, fiscalYear: period.fiscalYear.name }, tx);

      const countId = newId();
      await tx.stockCount.create({
        data: {
          id: countId,
          companyId: actor.companyId,
          number,
          warehouseId: input.warehouseId,
          documentDate: input.documentDate,
          actorId: actor.id,
          correlationId,
          lines: {
            create: lineRecords.map((l, index) => ({
              id: newId(),
              itemId: l.itemId,
              systemQuantity: l.systemQuantity,
              countedQuantity: l.countedQuantity,
              unitCost: l.unitCost,
              lineNumber: index + 1,
            })),
          },
        },
      });

      return { id: countId, number };
    });

    await this.audit.log({ actorId: actor.id, action: "stock_count.recorded", entityType: "StockCount", entityId: result.id, after: result, correlationId });
    return result;
  }

  async post(countId: string, actor: StockCountActor, correlationId: string, idempotencyKey: string): Promise<StockCountPostResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: countId, companyId: actor.companyId },
        include: { lines: true },
      });
      if (!count) throw new StockCountError("COUNT_NOT_FOUND", "Stock count not found");
      if (count.postedAt) throw new StockCountError("ALREADY_POSTED", "This stock count is already posted");

      let totalShortage = new Prisma.Decimal(0);
      let totalSurplus = new Prisma.Decimal(0);
      // Movement rows are created once a journal entry id is known (or known not to exist) —
      // stock_movements.journal_entry_id is NOT NULL with a real foreign key, so there is no
      // valid placeholder to insert and fix up later within the same transaction.
      const movedLines: { itemId: string; variance: Prisma.Decimal; unitCost: Prisma.Decimal; varianceValue: Prisma.Decimal }[] = [];

      for (const line of count.lines) {
        const stock = await lockStockRow(tx, actor.companyId, line.itemId, count.warehouseId);
        const adjustment = applyCountAdjustment(stock.state, line.countedQuantity, line.unitCost);
        await saveStockRow(tx, stock.id, adjustment.state);

        if (adjustment.varianceValue.lessThan(0)) totalShortage = totalShortage.plus(adjustment.varianceValue.negated());
        else if (adjustment.varianceValue.greaterThan(0)) totalSurplus = totalSurplus.plus(adjustment.varianceValue);

        if (!adjustment.variance.isZero()) {
          movedLines.push({ itemId: line.itemId, variance: adjustment.variance, unitCost: line.unitCost, varianceValue: adjustment.varianceValue });
        }
      }

      let journalEntryId: string | null = null;
      // Nothing varied: no account has anything to record, and IAccountingEngine.postEntry
      // requires at least 2 lines — there is nothing to post.
      if (totalShortage.greaterThan(0) || totalSurplus.greaterThan(0)) {
        const period = await findOpenFiscalPeriod(tx, actor.companyId, count.documentDate);
        const currency = await companyCurrency(tx, actor.companyId);
        if (!period) throw new StockCountError("NO_OPEN_PERIOD", "No open fiscal period covers this document date");

        const lossAccountId = totalShortage.greaterThan(0) ? await this.accountMappings.resolve(tx, actor.companyId, "COUNT_LOSS") : null;
        const gainAccountId = totalSurplus.greaterThan(0) ? await this.accountMappings.resolve(tx, actor.companyId, "COUNT_GAIN") : null;
        const inventoryAccountId = await this.accountMappings.resolve(tx, actor.companyId, "INVENTORY");
        // Net the inventory side (one account either way); loss and gain stay on their own
        // accounts and are never netted against each other — see the module README for the
        // balance proof.
        const netInventory = totalSurplus.minus(totalShortage);

        const lines = [
          ...(lossAccountId ? [{ accountId: lossAccountId, debit: totalShortage.toFixed(4), description: "Stock count shortage" }] : []),
          ...(gainAccountId ? [{ accountId: gainAccountId, credit: totalSurplus.toFixed(4), description: "Stock count surplus" }] : []),
          ...(netInventory.greaterThan(0)
            ? [{ accountId: inventoryAccountId, debit: netInventory.toFixed(4), description: "Stock count adjustment" }]
            : netInventory.lessThan(0)
              ? [{ accountId: inventoryAccountId, credit: netInventory.negated().toFixed(4), description: "Stock count adjustment" }]
              : []),
        ];

        const posting = await this.engine.postEntry(
          {
            companyId: actor.companyId,
            fiscalPeriodId: period.id,
            entryDate: count.documentDate,
            postingDate: count.documentDate,
            currency,
            lines,
            sourceModule: "inventory",
            sourceDocumentType: "stock_count",
            sourceDocumentId: countId,
            actorId: actor.id,
            correlationId,
            idempotencyKey,
          },
          tx,
        );
        journalEntryId = posting.journalEntryId;

        await tx.stockMovement.createMany({
          data: movedLines.map((l) => ({
            id: newId(),
            companyId: actor.companyId,
            itemId: l.itemId,
            warehouseId: count.warehouseId,
            movementType: "COUNT_ADJUSTMENT",
            quantity: l.variance,
            unitCost: l.unitCost,
            value: l.varianceValue.abs(),
            sourceDocumentType: "stock_count",
            sourceDocumentId: countId,
            journalEntryId: journalEntryId as string,
            actorId: actor.id,
            correlationId,
          })),
        });
        for (const line of count.lines) {
          await tx.stockCountLine.update({ where: { id: line.id }, data: { journalEntryId } });
        }
      }

      await tx.stockCount.update({ where: { id: countId }, data: { postedAt: new Date() } });

      return { id: countId, journalEntryId };
    });

    await this.audit.log({ actorId: actor.id, action: "stock_count.posted", entityType: "StockCount", entityId: result.id, after: result, correlationId });
    return result;
  }
}
