import { Money } from "@erp/shared";
import { escapeHtml } from "../../common/html-escape.js";
import type { SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// Shared shell for the accounting report PDFs (trial balance, balance sheet, income
// statement) — same reasoning as generic-document-template.ts: logical CSS
// properties throughout (docs/08-FRONTEND-I18N-RULES.md §4) so one stylesheet is
// correct in both directions, and every dynamic value is escaped even though it
// comes from our own i18next output (the interpolated params inside it —
// company name, dates — are caller-supplied).
export function renderReportShell(params: {
  readonly language: SupportedDocumentLanguage;
  readonly documentTitle: string;
  readonly companyName: string;
  readonly title: string;
  readonly subtitle: string;
  readonly bodyHtml: string;
}): string {
  const dir = params.language === "ar" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${params.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(params.documentTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  body {
    font-family: "Segoe UI", "Noto Sans Arabic", sans-serif;
    color: #1a1a1a;
    margin: 0;
    font-size: 10pt;
  }
  h1 { font-size: 16pt; margin-block-end: 2pt; }
  .company-name { font-weight: 600; font-size: 11pt; margin-block-end: 10pt; }
  .subtitle { color: #555; margin-block-end: 14pt; }
  h2 { font-size: 12pt; margin-block: 14pt 6pt; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 4pt; }
  th, td { border: 1px solid #ccc; padding: 5pt 8pt; text-align: start; }
  th { background: #f4f5fb; font-weight: 600; }
  td.amount, th.amount { text-align: end; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 600; background: #fafafa; }
  .grand-total { margin-block-start: 10pt; font-weight: 700; font-size: 11pt; }
</style>
</head>
<body>
<p class="company-name">${escapeHtml(params.companyName)}</p>
<h1>${escapeHtml(params.title)}</h1>
<p class="subtitle">${escapeHtml(params.subtitle)}</p>
${params.bodyHtml}
</body>
</html>`;
}

export interface ReportTableRow {
  readonly code: string;
  readonly name: string;
  readonly amount: string;
}

export function renderReportTable(params: {
  readonly accountHeader: string;
  readonly amountHeader: string;
  readonly rows: readonly ReportTableRow[];
  readonly totalLabel: string;
  readonly totalAmount: string;
  readonly currency: string;
}): string {
  const bodyRows = params.rows
    .map(
      (row) => `<tr><td>${escapeHtml(row.code ? `${row.code} — ${row.name}` : row.name)}</td><td class="amount">${escapeHtml(formatAmount(row.amount, params.currency))}</td></tr>`,
    )
    .join("");
  return `<table>
<thead><tr><th>${escapeHtml(params.accountHeader)}</th><th class="amount">${escapeHtml(params.amountHeader)}</th></tr></thead>
<tbody>
${bodyRows}
<tr class="total-row"><td>${escapeHtml(params.totalLabel)}</td><td class="amount">${escapeHtml(formatAmount(params.totalAmount, params.currency))}</td></tr>
</tbody>
</table>`;
}

export function formatAmount(amount: string, currency: string): string {
  return `${Money.of(amount, currency).toDecimalString()} ${currency}`;
}
