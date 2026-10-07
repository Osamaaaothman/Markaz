import type { LedgerStatement } from "@erp/core";
import { generalLedgerToCsv, generalLedgerToPdfHtml } from "./general-ledger-export.js";

const statement: LedgerStatement = {
  accountId: "a1",
  accountCode: "1100",
  accountName: "Cash, main",
  normalBalance: "DEBIT",
  from: "2026-01-01",
  to: "2026-01-31",
  openingBalance: "100.0000",
  totalDebit: "50.0000",
  totalCredit: "20.0000",
  closingBalance: "130.0000",
  lines: [
    { entryId: "e1", entryNumber: "JE-2026-000001", entryDate: "2026-01-05", description: "Sale <b>", debit: "50.0000", credit: "0.0000", balance: "150.0000" },
    { entryId: "e2", entryNumber: "JE-2026-000002", entryDate: "2026-01-09", description: null, debit: "0.0000", credit: "20.0000", balance: "130.0000" },
  ],
  truncated: false,
};

describe("general ledger export", () => {
  it("CSV has a BOM, the opening row, every line, and a total row with the closing balance", () => {
    const csv = generalLedgerToCsv(statement);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Opening balance");
    expect(csv).toContain("JE-2026-000002");
    expect(csv).toContain('"1100 Cash, main"');
    expect(csv.trimEnd().endsWith("130.0000")).toBe(true);
  });

  it("PDF html is RTL in Arabic, escapes descriptions, and shows the closing balance", async () => {
    const html = await generalLedgerToPdfHtml({ statement, language: "ar", companyName: "Acme", currency: "SAR" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("كشف حساب");
    expect(html).toContain("Sale &lt;b&gt;");
    expect(html).not.toContain("Sale <b>");
    expect(html).toContain("130.00 SAR");
  });
});
