import type { IncomeStatementResult } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell, renderReportTable } from "./report-document.util.js";

export function incomeStatementToCsv(result: IncomeStatementResult): string {
  const rows: string[][] = [["Section", "Account Code", "Account Name", "Amount"]];
  for (const line of result.revenue.lines) {
    rows.push(["Revenue", line.accountCode, line.accountName, line.amount]);
  }
  rows.push(["Revenue", "", "Total Revenue", result.revenue.total]);
  for (const line of result.expense.lines) {
    rows.push(["Expenses", line.accountCode, line.accountName, line.amount]);
  }
  rows.push(["Expenses", "", "Total Expenses", result.expense.total]);
  rows.push(["", "", "Net Income", result.netIncome]);
  return toCsvDocument(rows);
}

export async function incomeStatementToPdfHtml(params: {
  readonly result: IncomeStatementResult;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { result, currency } = params;

  const revenueTable = renderReportTable({
    accountHeader: t("incomeStatement.account"),
    amountHeader: t("incomeStatement.amount"),
    rows: result.revenue.lines.map((l) => ({ code: l.accountCode, name: l.accountName, amount: l.amount })),
    totalLabel: t("incomeStatement.totalRevenue"),
    totalAmount: result.revenue.total,
    currency,
  });
  const expenseTable = renderReportTable({
    accountHeader: t("incomeStatement.account"),
    amountHeader: t("incomeStatement.amount"),
    rows: result.expense.lines.map((l) => ({ code: l.accountCode, name: l.accountName, amount: l.amount })),
    totalLabel: t("incomeStatement.totalExpense"),
    totalAmount: result.expense.total,
    currency,
  });

  const netLabel = result.netIncome.startsWith("-") ? t("incomeStatement.netLoss") : t("incomeStatement.netIncome");
  const bodyHtml = `
<h2>${escapeHtml(t("incomeStatement.revenue"))}</h2>
${revenueTable}
<h2>${escapeHtml(t("incomeStatement.expense"))}</h2>
${expenseTable}
<p class="grand-total">${escapeHtml(netLabel)}: ${escapeHtml(formatAmount(result.netIncome, currency))}</p>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("incomeStatement.title"),
    companyName: params.companyName,
    title: t("incomeStatement.title"),
    subtitle: t("incomeStatement.subtitle", { from: result.from, to: result.to }),
    bodyHtml,
  });
}
