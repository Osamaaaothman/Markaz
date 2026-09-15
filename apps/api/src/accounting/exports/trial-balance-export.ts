import type { TrialBalanceResult } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell } from "./report-document.util.js";

export function trialBalanceToCsv(result: TrialBalanceResult): string {
  const rows: string[][] = [["Account Code", "Account Name", "Debit", "Credit"]];
  for (const line of result.lines) {
    rows.push([line.accountCode, line.accountName, line.debitTotal, line.creditTotal]);
  }
  rows.push(["", "Total", result.totalDebit, result.totalCredit]);
  return toCsvDocument(rows);
}

// Doesn't reuse report-document.util's renderReportTable: a trial balance needs
// TWO amount columns side by side (debit and credit), unlike the balance
// sheet/income statement where each line is a single signed figure.
export async function trialBalanceToPdfHtml(params: {
  readonly result: TrialBalanceResult;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const asOf = new Date().toISOString().slice(0, 10);

  const bodyRows = params.result.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(`${line.accountCode} — ${line.accountName}`)}</td>` +
        `<td class="amount">${escapeHtml(formatAmount(line.debitTotal, params.currency))}</td>` +
        `<td class="amount">${escapeHtml(formatAmount(line.creditTotal, params.currency))}</td></tr>`,
    )
    .join("");

  const bodyHtml = `<table>
<thead><tr><th>${escapeHtml(t("trialBalance.account"))}</th><th class="amount">${escapeHtml(t("trialBalance.debit"))}</th><th class="amount">${escapeHtml(t("trialBalance.credit"))}</th></tr></thead>
<tbody>
${bodyRows}
<tr class="total-row"><td>${escapeHtml(`${t("trialBalance.totalDebit")} / ${t("trialBalance.totalCredit")}`)}</td><td class="amount">${escapeHtml(formatAmount(params.result.totalDebit, params.currency))}</td><td class="amount">${escapeHtml(formatAmount(params.result.totalCredit, params.currency))}</td></tr>
</tbody>
</table>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("trialBalance.title"),
    companyName: params.companyName,
    title: t("trialBalance.title"),
    subtitle: t("trialBalance.subtitle", { asOf }),
    bodyHtml,
  });
}
