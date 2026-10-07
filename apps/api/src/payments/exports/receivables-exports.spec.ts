import type { AgingReport, PartyStatement } from "@erp/core";
import { agingToCsv, agingToPdfHtml, statementToCsv, statementToPdfHtml } from "./receivables-exports.js";

const report: AgingReport = {
  side: "SALES",
  asOf: "2026-03-31",
  parties: [
    { partyId: "p1", partyName: "Acme", partyNameAr: "أكمي", current: "450.0000", days1to30: "0.0000", days31to60: "700.0000", days61to90: "0.0000", over90: "0.0000", onAccount: "-100.0000", total: "1050.0000" },
  ],
  totals: { current: "450.0000", days1to30: "0.0000", days31to60: "700.0000", days61to90: "0.0000", over90: "0.0000", onAccount: "-100.0000", total: "1050.0000" },
  ledgerBalance: "1050.0000",
  difference: "0.0000",
};

const statement: PartyStatement = {
  side: "SALES",
  partyId: "p1",
  partyName: "Acme <Co>",
  partyNameAr: null,
  from: "2026-03-01",
  to: "2026-03-31",
  openingBalance: "1000.0000",
  totalCharges: "500.0000",
  totalSettlements: "450.0000",
  closingBalance: "1050.0000",
  lines: [{ kind: "INVOICE", documentId: "d1", number: "INV-1", date: "2026-03-20", reference: null, charge: "500.0000", settlement: "0.0000", balance: "1500.0000" }],
};

describe("receivables exports", () => {
  it("ageing CSV has a BOM, one row per party, the total, and the ledger tie", () => {
    const csv = agingToCsv(report, "ar");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("أكمي");
    expect(csv).toContain("Ledger balance");
    expect(csv).toContain("Difference");
  });

  it("ageing PDF html is RTL in Arabic and shows the tie to the ledger", async () => {
    const html = await agingToPdfHtml({ report, language: "ar", companyName: "Co", currency: "SAR" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("أعمار الذمم المدينة");
    expect(html).toContain("1050.00 SAR");
  });

  it("ageing PDF says so when the control account is unmapped", async () => {
    const html = await agingToPdfHtml({ report: { ...report, ledgerBalance: null, difference: null }, language: "en", companyName: "Co", currency: "SAR" });
    expect(html).toContain("not mapped yet");
  });

  it("statement CSV and PDF carry the opening and closing balance, and escape names", async () => {
    expect(statementToCsv(statement, "en")).toContain("1050.0000");
    const html = await statementToPdfHtml({ statement, language: "en", companyName: "Co", currency: "SAR" });
    expect(html).toContain("Acme &lt;Co&gt;");
    expect(html).not.toContain("<Co>");
    expect(html).toContain("1000.00 SAR");
  });
});
