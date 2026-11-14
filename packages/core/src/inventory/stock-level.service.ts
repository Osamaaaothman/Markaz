import type { PrismaClient } from "@erp/db";
import { averageUnitCost } from "./weighted-average.util.js";

export interface StockLevelEntry {
  readonly itemId: string;
  readonly itemRef: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly quantity: string;
  readonly value: string;
  readonly averageUnitCost: string;
  readonly costStatus: "FINAL" | "PROVISIONAL" | "PENDING";
  readonly reorderPoint: string;
  readonly belowReorderPoint: boolean;
}

export interface StockLevelQuery {
  readonly warehouseId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly belowReorderOnly?: "true" | "false" | undefined;
}

// Read-only view over item_warehouse_stock for the stock-levels screen and the reorder list —
// no mutation lives here, every quantity/value change goes through a posting service
// (goods receipt, stock issue, stock count) so it is always paired with a stock_movements row.
export class StockLevelService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(companyId: string, query: StockLevelQuery): Promise<StockLevelEntry[]> {
    const rows = await this.prisma.itemWarehouseStock.findMany({
      where: {
        companyId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
      },
      include: { item: true, warehouse: true },
      orderBy: [{ item: { code: "asc" } }, { warehouse: { code: "asc" } }],
    });

    const pending = await this.prisma.inventoryShortfall.findMany({ where: { companyId, remainingQuantity: { gt: 0 }, costKnown: false }, select: { itemId: true, warehouseId: true } });
    const unknownPools = new Set(pending.map((s) => `${s.itemId}:${s.warehouseId}`));
    const entries = rows.map<StockLevelEntry>((row) => {
      const belowReorderPoint = row.quantity.lessThan(row.item.reorderPoint);
      return {
        itemId: row.itemId,
        itemRef: row.item.ref,
        itemCode: row.item.code,
        itemName: row.item.name,
        itemNameAr: row.item.nameAr,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        warehouseNameAr: row.warehouse.nameAr,
        quantity: row.quantity.toFixed(4),
        value: row.value.toFixed(4),
        averageUnitCost: (row.quantity.isZero() ? row.lastUnitCost : averageUnitCost(row))?.toFixed(4) ?? "0.0000",
        costStatus: row.quantity.lessThan(0) ? (unknownPools.has(`${row.itemId}:${row.warehouseId}`) ? "PENDING" : "PROVISIONAL") : "FINAL",
        reorderPoint: row.item.reorderPoint.toFixed(4),
        belowReorderPoint,
      };
    });

    return query.belowReorderOnly === "true" ? entries.filter((e) => e.belowReorderPoint) : entries;
  }
}
