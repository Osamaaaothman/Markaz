import type { StockMovementEntry } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";

export function stockMovementsToCsv(entries: readonly StockMovementEntry[]): string {
  const rows: string[][] = [["Date", "Item Code", "Item", "Warehouse", "Type", "Quantity", "Unit Cost", "Value", "Source", "Entry"]];
  for (const e of entries) {
    rows.push([e.date.slice(0, 10), e.itemCode, e.itemName, e.warehouseName, e.movementType, e.quantity, e.unitCost, e.value, e.sourceDocumentType, e.entryNumber]);
  }
  return toCsvDocument(rows);
}
