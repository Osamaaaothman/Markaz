import type { StockLevelEntry } from "@erp/core";
import { stockLevelsToCsv, stockLevelsToPdfHtml, totalStockValue } from "./stock-levels-export.js";

const entry = (over: Partial<StockLevelEntry>): StockLevelEntry => ({
  itemId: "i1",
  itemRef: "ITM-000001",
  itemCode: "CEM-50",
  itemName: "Cement 50kg",
  itemNameAr: "أسمنت ٥٠ كجم",
  warehouseId: "w1",
  warehouseName: "Main",
  quantity: "10.0000",
  value: "100.1000",
  averageUnitCost: "10.0100",
  reorderPoint: "5.0000",
  belowReorderPoint: false,
  ...over,
});

describe("stock levels export", () => {
  it("sums values exactly, keeping four decimals", () => {
    const entries = [entry({ value: "0.1000" }), entry({ value: "0.2000" })];
    expect(totalStockValue(entries, "SAR")).toBe("0.3000");
  });

  it("CSV has a BOM, one row per stock line and a total row", () => {
    const csv = stockLevelsToCsv([entry({}), entry({ itemCode: "SND", itemRef: "ITM-000002" })], "SAR");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("ITM-000002");
    expect(csv.trimEnd().split("\r\n").pop()).toContain("200.2000");
  });

  it("PDF html uses the Arabic item name in Arabic and escapes values", async () => {
    const html = await stockLevelsToPdfHtml({
      entries: [entry({ warehouseName: "A<script>" })],
      language: "ar",
      companyName: "Acme",
      currency: "SAR",
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("أسمنت ٥٠ كجم");
    expect(html).not.toContain("<script>");
  });
});
