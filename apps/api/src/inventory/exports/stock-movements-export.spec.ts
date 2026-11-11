import type { StockMovementEntry } from "@erp/core";
import { stockMovementsToCsv, stockMovementsToPdfHtml } from "./stock-movements-export.js";

const entry: StockMovementEntry = {
  id: "m1",
  date: "2026-03-20T09:30:00.000Z",
  itemId: "i1",
  itemCode: "CEM-50",
  itemName: "Cement, 50kg",
  itemNameAr: null,
  warehouseId: "w1",
  warehouseName: "Main",
  warehouseNameAr: null,
  movementType: "ISSUE",
  quantity: "-4.0000",
  unitCost: "5.0000",
  value: "20.0000",
  sourceDocumentType: "sales_invoice",
  partyName: "Customer, Co",
  partyNameAr: "شركة العميل",
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
    expect(csv).toContain("Customer / Supplier");
    expect(csv).toContain('"Customer, Co"');
    expect(csv).toContain("شركة العميل");
  });

  it("leaves the party columns empty for an internal movement", () => {
    expect(stockMovementsToCsv([{ ...entry, partyName: null, partyNameAr: null }])).toContain("000007,,\r\n");
  });

  it("renders an Arabic landscape report with names, precise signed amounts and escaped data", async () => {
    const html = await stockMovementsToPdfHtml({ entries: [{ ...entry, itemNameAr: "أسمنت", warehouseNameAr: "الرئيسي", partyNameAr: "<script>شركة</script>" }], language: "ar", companyName: "مركز", currency: "SAR" });
    expect(html).toContain("A4 landscape");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("أسمنت");
    expect(html).toContain("الرئيسي");
    expect(html).toContain("-4.0000");
    expect(html).toContain("5.0000");
    expect(html).toContain("000007");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("stockMovements.");
  });

  it("prints the date range and a clear empty report without inventing totals", async () => {
    const html = await stockMovementsToPdfHtml({ entries: [], language: "en", companyName: "Markaz", currency: "SAR", from: "2026-01-01", to: "2026-02-01" });
    expect(html).toContain("No movements match this export.");
    expect(html).toContain("2026-01-01 — 2026-02-01");
    expect(html).toContain("Movements: 0");
  });
});
