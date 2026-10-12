import type { PeriodTrialBalanceResult } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell } from "./report-document.util.js";

export function trialBalanceToCsv(result: PeriodTrialBalanceResult): string {
  const rows: string[][] = [
    ["Account Code", "Account Name", "Opening Debit", "Opening Credit", "Movement Debit", "Movement Credit", "Closing Debit", "Closing Credit"],
  ];
  for (const l of result.lines) {
    rows.push([l.accountCode, l.accountName, l.openingDebit, l.openingCredit, l.movementDebit, l.movementCredit, l.closingDebit, l.closingCredit]);
  }
  const t = result.totals;
  rows.push(["", "Total", t.openingDebit, t.openingCredit, t.movementDebit, t.movementCredit, t.closingDebit, t.closingCredit]);
  return toCsvDocument(rows);
}

// Landscape: eight amount columns do not fit a portrait A4 page. The columns are grouped under three headings,
// opening balance, movement and closing balance, each split into debit and credit.
export async function trialBalanceToPdfHtml(params: {
  readonly result: PeriodTrialBalanceResult;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
  readonly logoDataUri?: string | undefined;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const amount = (value: string): string => `<td class="amount">${escapeHtml(formatAmount(value, params.currency))}</td>`;
  const { result } = params;

  const bodyRows = result.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(`${l.accountCode} — ${l.accountName}`)}</td>` +
        amount(l.openingDebit) + amount(l.openingCredit) +
        amount(l.movementDebit) + amount(l.movementCredit) +
        amount(l.closingDebit) + amount(l.closingCredit) +
        "</tr>",
    )
    .join("");
  const totals = result.totals;

  const bodyHtml = `<table class="tb">
<thead>
<tr><th rowspan="2">${escapeHtml(t("trialBalance.account"))}</th><th colspan="2" class="amount group">${escapeHtml(t("trialBalance.opening"))}</th><th colspan="2" class="amount group">${escapeHtml(t("trialBalance.movement"))}</th><th colspan="2" class="amount group">${escapeHtml(t("trialBalance.closing"))}</th></tr>
<tr>${["debit", "credit", "debit", "credit", "debit", "credit"].map((k) => `<th class="amount">${escapeHtml(t(`trialBalance.${k}`))}</th>`).join("")}</tr>
</thead>
<tbody>
${bodyRows}
<tr class="total-row"><td>${escapeHtml(t("trialBalance.total"))}</td>${amount(totals.openingDebit)}${amount(totals.openingCredit)}${amount(totals.movementDebit)}${amount(totals.movementCredit)}${amount(totals.closingDebit)}${amount(totals.closingCredit)}</tr>
</tbody>
</table>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("trialBalance.title"),
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    title: t("trialBalance.title"),
    subtitle: t("trialBalance.periodSubtitle", { from: result.from, to: result.to }),
    bodyHtml,
    extraCss: `@page { size: A4 landscape; margin: 12mm; } .tb { font-size: 8.5pt; } .tb th.group { text-align: center; } .tb td, .tb th { padding: 3pt 5pt; }`,
  });
}
