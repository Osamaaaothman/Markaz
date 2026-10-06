import type { StockMovementEntry } from "@erp/core";
import { stockMovementsToCsv } from "./stock-movements-export.js";

const entry: StockMovementEntry = {
  id: "m1",
  date: "2026-03-20T09:30:00.000Z",
  itemId: "i1",
  itemCode: "CEM-50",
  itemName: "Cement, 50kg",
  itemNameAr: null,
  warehouseId: "w1",
  warehouseName: "Main",
  movementType: "ISSUE",
  quantity: "-4.0000",
  unitCost: "5.0000",
  value: "20.0000",
  sourceDocumentType: "sales_invoice",
  journalEntryId: "j1",
  entryNumber: "000007",
};

describe("stock movements CSV", () => {
  it("has a BOM, a header, signed quantities and quotes a comma in a name", () => {
    const csv = stockMovementsToCsv([entry]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Entry");
    expect(csv).toContain('"Cement, 50kg"');
    expect(csv).toContain("-4.0000");
    expect(csv).toContain("2026-03-20");
  });
});
