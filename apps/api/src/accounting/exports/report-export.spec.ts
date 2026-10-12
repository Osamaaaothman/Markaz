import type { BalanceSheetResult, IncomeStatementResult, PeriodTrialBalanceResult } from "@erp/core";
import { closePdfRenderer, renderHtmlToPdf } from "../../documents/pdf-renderer.js";
import { balanceSheetToCsv, balanceSheetToPdfHtml } from "./balance-sheet-export.js";
import { incomeStatementToCsv, incomeStatementToPdfHtml } from "./income-statement-export.js";
import { trialBalanceToCsv, trialBalanceToPdfHtml } from "./trial-balance-export.js";

const trialBalanceFixture: PeriodTrialBalanceResult = {
  from: "2026-01-01",
  to: "2026-12-31",
  lines: [
    { accountId: "a1", accountCode: "1100", accountName: "Cash", accountType: "ASSET", openingDebit: "0.0000", openingCredit: "0.0000", movementDebit: "1000.0000", movementCredit: "0.0000", closingDebit: "1000.0000", closingCredit: "0.0000" },
    { accountId: "a2", accountCode: "4100", accountName: "Sales Revenue", accountType: "REVENUE", openingDebit: "0.0000", openingCredit: "0.0000", movementDebit: "0.0000", movementCredit: "1000.0000", closingDebit: "0.0000", closingCredit: "1000.0000" },
  ],
  totals: { openingDebit: "0.0000", openingCredit: "0.0000", movementDebit: "1000.0000", movementCredit: "1000.0000", closingDebit: "1000.0000", closingCredit: "1000.0000" },
  isBalanced: true,
};

const balanceSheetFixture: BalanceSheetResult = {
  asOf: "2026-01-01",
  assets: { lines: [{ accountId: "a1", accountCode: "1100", accountName: "Cash", balance: "1000.0000" }], total: "1000.0000" },
  liabilities: { lines: [], total: "0.0000" },
  equity: { lines: [], total: "0.0000" },
  currentYearEarnings: "1000.0000",
  totalEquity: "1000.0000",
  totalLiabilitiesAndEquity: "1000.0000",
  isBalanced: true,
};

const incomeStatementFixture: IncomeStatementResult = {
  from: "2026-01-01",
  to: "2026-12-31",
  revenue: { lines: [{ accountId: "a2", accountCode: "4100", accountName: "Sales Revenue", amount: "1000.0000" }], total: "1000.0000" },
  expense: { lines: [], total: "0.0000" },
  netIncome: "1000.0000",
};

describe("accounting report exports — CSV", () => {
  it("trial balance CSV includes a UTF-8 BOM, header row, data rows, and a total row", () => {
    const csv = trialBalanceToCsv(trialBalanceFixture);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("1100");
    expect(csv).toContain("Cash");
    expect(csv).toContain("Total");
    expect(csv).toContain("Opening Debit");
    expect(csv).toContain("Closing Credit");
  });

  it("balance sheet CSV includes every section and the grand total", () => {
    const csv = balanceSheetToCsv(balanceSheetFixture);
    expect(csv).toContain("Assets");
    expect(csv).toContain("Total Liabilities and Equity");
  });

  it("income statement CSV includes revenue, expense, and net income", () => {
    const csv = incomeStatementToCsv(incomeStatementFixture);
    expect(csv).toContain("Revenue");
    expect(csv).toContain("Net Income");
  });

  it("quotes a CSV field containing a comma so it survives a spreadsheet re-import", () => {
    const withComma: PeriodTrialBalanceResult = {
      ...trialBalanceFixture,
      lines: [{ ...trialBalanceFixture.lines[0]!, accountName: "Cash, Petty" }],
    };
    const csv = trialBalanceToCsv(withComma);
    expect(csv).toContain('"Cash, Petty"');
  });
});

describe("accounting report exports — PDF HTML", () => {
  it.each(["en", "ar"] as const)("trial balance HTML sets dir=%s correctly", async (language) => {
    const html = await trialBalanceToPdfHtml({
      result: trialBalanceFixture,
      language,
      companyName: "Markaz",
      currency: "SAR",
    });
    expect(html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);
    expect(html).toContain("1100");
    expect(html).toContain("A4 landscape");
    expect(html).toContain("2026-12-31");
  });

  it.each(["en", "ar"] as const)("balance sheet HTML sets dir=%s correctly", async (language) => {
    const html = await balanceSheetToPdfHtml({
      result: balanceSheetFixture,
      language,
      companyName: "Markaz",
      currency: "SAR",
    });
    expect(html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);
  });

  it.each(["en", "ar"] as const)("income statement HTML sets dir=%s correctly", async (language) => {
    const html = await incomeStatementToPdfHtml({
      result: incomeStatementFixture,
      language,
      companyName: "Markaz",
      currency: "SAR",
    });
    expect(html).toContain(`dir="${language === "ar" ? "rtl" : "ltr"}"`);
  });
});

// docs/14-MILESTONES.md M3 gate: "a PDF renders correctly in Arabic RTL and English
// LTR" — one real end-to-end render (not just HTML shape) proves the whole pipeline
// still works for these new templates, same bar as the existing generic-document
// pipeline test.
describe("accounting report exports — real PDF render", () => {
  afterAll(async () => {
    await closePdfRenderer();
  });

  it.each(["en", "ar"] as const)("renders a valid income statement PDF for language=%s", async (language) => {
    const html = await incomeStatementToPdfHtml({
      result: incomeStatementFixture,
      language,
      companyName: language === "ar" ? "مركز" : "Markaz",
      currency: "SAR",
    });
    const pdf = await renderHtmlToPdf(html);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});
