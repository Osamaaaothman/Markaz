import { Prisma } from "@erp/db";
import { newId } from "@erp/shared";
import type { JournalLineInput, TransactionClient } from "../contracts.js";
import { lockStockRow, saveStockRow } from "./stock-row.repo.js";
import { applyIssue, averageUnitCost } from "./weighted-average.util.js";

interface Source { readonly type: string; readonly id: string; readonly lineNumber: number }
interface Pool { readonly companyId: string; readonly itemId: string; readonly warehouseId: string }
export interface CostSettlement extends Pool {
  readonly shortfallId: string;
  readonly expenseAccountId: string;
  readonly quantity: Prisma.Decimal;
  readonly estimatedValue: Prisma.Decimal;
  readonly actualValue: Prisma.Decimal;
}

/** Called within the document transaction. The stock row serializes issues and receipts. */
export async function issueStock(
  tx: TransactionClient, pool: Pool, quantity: Prisma.Decimal, source: Source, expenseAccount: string | (() => Promise<string>),
) {
  if (!quantity.greaterThan(0)) throw new RangeError("Issue quantity must be positive");
  const stock = await lockStockRow(tx, pool.companyId, pool.itemId, pool.warehouseId);
  const available = Prisma.Decimal.min(quantity, Prisma.Decimal.max(0, stock.state.quantity));
  const availableValue = available.isZero() ? new Prisma.Decimal(0) : applyIssue(stock.state, available).value;
  const shortage = quantity.minus(available);
  const referenceCost = stock.state.quantity.greaterThan(0) ? averageUnitCost(stock.state) : stock.lastUnitCost;
  const estimate = shortage.times(referenceCost ?? 0).toDecimalPlaces(4);
  const value = availableValue.plus(estimate);
  if (shortage.greaterThan(0)) {
    const expenseAccountId = typeof expenseAccount === "string" ? expenseAccount : await expenseAccount();
    await tx.$executeRaw`INSERT INTO inventory_shortfalls
      (id,company_id,item_id,warehouse_id,source_document_type,source_document_id,line_number,
       expense_account_id,quantity,estimated_value,cost_known,remaining_quantity,remaining_value)
      VALUES (${newId()},${pool.companyId},${pool.itemId},${pool.warehouseId},${source.type},${source.id},${source.lineNumber},
              ${expenseAccountId},${shortage},${estimate},${referenceCost !== null},${shortage},${estimate})`;
  }
  await saveStockRow(tx, stock.id, { quantity: stock.state.quantity.minus(quantity), value: stock.state.value.minus(value) });
  return { value, unitCost: value.div(quantity).toDecimalPlaces(4), shortageQuantity: shortage, costKnown: referenceCost !== null };
}

/** Receipts settle oldest outstanding quantities, with the exact last rounding remainder. */
export async function receiveStock(
  tx: TransactionClient, pool: Pool, quantity: Prisma.Decimal, value: Prisma.Decimal,
  preferredSource?: Source,
): Promise<CostSettlement[]> {
  if (!quantity.greaterThan(0) || value.lessThan(0)) throw new RangeError("Invalid stock receipt");
  const stock = await lockStockRow(tx, pool.companyId, pool.itemId, pool.warehouseId);
  const debts = await tx.$queryRaw<{ id: string; expense_account_id: string; remaining_quantity: Prisma.Decimal; remaining_value: Prisma.Decimal }[]>`
    SELECT id,expense_account_id,remaining_quantity,remaining_value FROM inventory_shortfalls
    WHERE company_id=${pool.companyId} AND item_id=${pool.itemId} AND warehouse_id=${pool.warehouseId} AND remaining_quantity>0
    ORDER BY CASE WHEN source_document_type=${preferredSource?.type ?? ""} AND source_document_id=${preferredSource?.id ?? ""}
      AND line_number=${preferredSource?.lineNumber ?? 0} THEN 0 ELSE 1 END,created_at,id FOR UPDATE`;
  const settlements: CostSettlement[] = [];
  let left = quantity;
  let allocatedValue = new Prisma.Decimal(0);
  for (const debt of debts) {
    if (left.isZero()) break;
    const taken = Prisma.Decimal.min(left, debt.remaining_quantity);
    const estimate = taken.equals(debt.remaining_quantity) ? debt.remaining_value : debt.remaining_value.times(taken).div(debt.remaining_quantity).toDecimalPlaces(4);
    const actual = value.times(quantity.minus(left).plus(taken)).div(quantity).toDecimalPlaces(4).minus(allocatedValue);
    allocatedValue = allocatedValue.plus(actual);
    left = left.minus(taken);
    settlements.push({ ...pool, shortfallId: debt.id, expenseAccountId: debt.expense_account_id, quantity: taken, estimatedValue: estimate, actualValue: actual });
    await tx.$executeRaw`UPDATE inventory_shortfalls SET remaining_quantity=remaining_quantity-${taken},remaining_value=remaining_value-${estimate}
      WHERE id=${debt.id} AND company_id=${pool.companyId}`;
  }
  const adjustment = settlements.reduce((sum, s) => sum.plus(s.actualValue.minus(s.estimatedValue)), new Prisma.Decimal(0));
  await saveStockRow(tx, stock.id, { quantity: stock.state.quantity.plus(quantity), value: stock.state.value.plus(value).minus(adjustment) });
  // A real incoming cost remains available even if the receipt only clears a shortage.
  await tx.$executeRaw`UPDATE item_warehouse_stock SET last_unit_cost=${value.div(quantity).toDecimalPlaces(8)}
    WHERE id=${stock.id} AND company_id=${pool.companyId} AND quantity<=0`;
  return settlements;
}

export function settlementJournalLines(settlements: readonly CostSettlement[], inventoryAccountId: string): JournalLineInput[] {
  const deltas = new Map<string, Prisma.Decimal>();
  for (const s of settlements) deltas.set(s.expenseAccountId, (deltas.get(s.expenseAccountId) ?? new Prisma.Decimal(0)).plus(s.actualValue.minus(s.estimatedValue)));
  return [...deltas].flatMap(([accountId, delta]) => delta.isZero() ? [] : [
    { accountId, ...(delta.greaterThan(0) ? { debit: delta.toFixed(4) } : { credit: delta.abs().toFixed(4) }), description: "Provisional inventory cost settled" },
    { accountId: inventoryAccountId, ...(delta.greaterThan(0) ? { credit: delta.toFixed(4) } : { debit: delta.abs().toFixed(4) }), description: "Provisional inventory cost settled" },
  ]);
}

export async function recordSettlements(
  tx: TransactionClient, settlements: readonly CostSettlement[], source: { readonly type: string; readonly id: string },
  journalEntryId: string | null, actorId: string, correlationId: string,
): Promise<void> {
  for (const s of settlements) {
    await tx.$executeRaw`INSERT INTO inventory_cost_settlements
      (id,shortfall_id,company_id,quantity,estimated_value,actual_value,source_document_type,source_document_id,journal_entry_id)
      VALUES (${newId()},${s.shortfallId},${s.companyId},${s.quantity},${s.estimatedValue},${s.actualValue},${source.type},${source.id},${journalEntryId})`;
    const delta = s.estimatedValue.minus(s.actualValue);
    if (!delta.isZero()) {
      if (!journalEntryId) throw new Error("Cost adjustment requires a journal entry");
      await tx.stockMovement.create({ data: {
        id: newId(), companyId: s.companyId, itemId: s.itemId, warehouseId: s.warehouseId,
        movementType: "COST_ADJUSTMENT", quantity: 0, unitCost: 0, value: delta,
        sourceDocumentType: source.type, sourceDocumentId: source.id, journalEntryId, actorId, correlationId,
      } });
    }
  }
}
