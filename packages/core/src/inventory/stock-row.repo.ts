import { Prisma } from "@erp/db";
import { newId } from "@erp/shared";
import type { TransactionClient } from "../contracts.js";
import type { StockState } from "./weighted-average.util.js";

export interface LockedStockRow {
  readonly id: string;
  readonly state: StockState;
  readonly lastUnitCost: Prisma.Decimal | null;
}

// Locks (creating the row first if this item has never had stock in this warehouse) the
// item+warehouse stock row inside the CALLER's transaction — the same row-lock-then-update
// shape packages/core/src/accounting/numbering.service.ts uses for document numbering, so two
// concurrent documents touching the same item+warehouse never lose an update (docs/05
// §9 principle: a concurrent race is a database-level concern, not just an application one).
export async function lockStockRow(
  tx: TransactionClient,
  companyId: string,
  itemId: string,
  warehouseId: string,
): Promise<LockedStockRow> {
  await tx.$executeRaw`
    INSERT INTO item_warehouse_stock (id, company_id, item_id, warehouse_id, quantity, value, updated_at)
    VALUES (${newId()}, ${companyId}, ${itemId}, ${warehouseId}, 0, 0, now())
    ON CONFLICT (item_id, warehouse_id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; value: Prisma.Decimal; last_unit_cost: Prisma.Decimal | null }[]>`
    SELECT id, quantity, value, last_unit_cost FROM item_warehouse_stock
    WHERE company_id = ${companyId} AND item_id = ${itemId} AND warehouse_id = ${warehouseId}
    FOR UPDATE
  `;
  const row = rows[0];
  /* istanbul ignore next -- the INSERT above guarantees a row exists by the time this runs */
  if (!row) throw new Error(`Failed to lock the stock row for item ${itemId} in warehouse ${warehouseId}`);
  return { id: row.id, lastUnitCost: row.last_unit_cost, state: { quantity: new Prisma.Decimal(row.quantity), value: new Prisma.Decimal(row.value) } };
}

export async function saveStockRow(tx: TransactionClient, id: string, state: StockState): Promise<void> {
  if (state.quantity.greaterThan(0)) {
    await tx.$executeRaw`UPDATE item_warehouse_stock SET last_unit_cost=${state.value.div(state.quantity).toDecimalPlaces(8)} WHERE id=${id}`;
  }
  await tx.itemWarehouseStock.update({
    where: { id },
    data: { quantity: state.quantity, value: state.value, version: { increment: 1 } },
  });
}
