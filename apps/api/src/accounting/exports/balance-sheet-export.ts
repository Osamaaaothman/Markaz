import type { BalanceSheetResult } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell, renderReportTable } from "./report-document.util.js";

export function balanceSheetToCsv(result: BalanceSheetResult): string {
  const rows: string[][] = [["Section", "Account Code", "Account Name", "Balance"]];
  for (const line of result.assets.lines) {
    rows.push(["Assets", line.accountCode, line.accountName, line.balance]);
  }
  rows.push(["Assets", "", "Total Assets", result.assets.total]);
  for (const line of result.liabilities.lines) {
    rows.push(["Liabilities", line.accountCode, line.accountName, line.balance]);
  }
  rows.push(["Liabilities", "", "Total Liabilities", result.liabilities.total]);
  for (const line of result.equity.lines) {
    rows.push(["Equity", line.accountCode, line.accountName, line.balance]);
  }
  rows.push(["Equity", "", "Current Year Earnings", result.currentYearEarnings]);
  rows.push(["Equity", "", "Total Equity", result.totalEquity]);
  rows.push(["", "", "Total Liabilities and Equity", result.totalLiabilitiesAndEquity]);
  return toCsvDocument(rows);
}

export async function balanceSheetToPdfHtml(params: {
  readonly result: BalanceSheetResult;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { result, currency } = params;

  const assetsTable = renderReportTable({
    accountHeader: t("balanceSheet.account"),
    amountHeader: t("balanceSheet.balance"),
    rows: result.assets.lines.map((l) => ({ code: l.accountCode, name: l.accountName, amount: l.balance })),
    totalLabel: t("balanceSheet.totalAssets"),
    totalAmount: result.assets.total,
    currency,
  });
  const liabilitiesTable = renderReportTable({
    accountHeader: t("balanceSheet.account"),
    amountHeader: t("balanceSheet.balance"),
    rows: result.liabilities.lines.map((l) => ({ code: l.accountCode, name: l.accountName, amount: l.balance })),
    totalLabel: t("balanceSheet.totalLiabilities"),
    totalAmount: result.liabilities.total,
    currency,
  });
  const equityTable = renderReportTable({
    accountHeader: t("balanceSheet.account"),
    amountHeader: t("balanceSheet.balance"),
    rows: [
      ...result.equity.lines.map((l) => ({ code: l.accountCode, name: l.accountName, amount: l.balance })),
      { code: "", name: t("balanceSheet.currentYearEarnings"), amount: result.currentYearEarnings },
    ],
    totalLabel: t("balanceSheet.totalEquity"),
    totalAmount: result.totalEquity,
    currency,
  });

  const bodyHtml = `
<h2>${t("balanceSheet.assets")}</h2>
${assetsTable}
<h2>${t("balanceSheet.liabilities")}</h2>
${liabilitiesTable}
<h2>${t("balanceSheet.equity")}</h2>
${equityTable}
<p class="grand-total">${escapeHtml(t("balanceSheet.totalLiabilitiesAndEquity"))}: ${escapeHtml(formatAmount(result.totalLiabilitiesAndEquity, currency))}</p>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("balanceSheet.title"),
    companyName: params.companyName,
    title: t("balanceSheet.title"),
    subtitle: t("balanceSheet.subtitle", { asOf: result.asOf }),
    bodyHtml,
  });
}
