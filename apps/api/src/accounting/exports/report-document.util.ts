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
  // Omit or pass empty string to suppress the subtitle paragraph.
  readonly subtitle?: string;
  readonly bodyHtml: string;
  // HTML rendered at the very bottom of the page (issued-by + computer-generated notice).
  readonly footerHtml?: string;
  // The company logo as a data: URI (never a remote URL: a PDF must not fetch anything). Optional.
  readonly logoDataUri?: string;
  // Seller identity lines printed under the company name (VAT, CR, address, phone). Raw, unescaped strings.
  readonly sellerDetailLines?: readonly string[];
  // Extra CSS appended after the shell's own (a dense table for a report with many columns).
  readonly extraCss?: string;
}): string {
  const dir = params.language === "ar" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${params.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(params.documentTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  html { height: 100%; }
  body {
    font-family: "Segoe UI", "Noto Sans Arabic", sans-serif;
    color: #1a1a1a;
    margin: 0;
    font-size: 10pt;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .report-main { flex: 1; }
  .report-footer-block { padding-block-start: 8pt; border-block-start: 1px solid #ddd; }
  .issued-by-block { padding: 6pt 10pt; border: 1px solid #e8e8e8; border-radius: 4pt; font-size: 8pt; color: #555; display: flex; gap: 24pt; margin-block-end: 10pt; }
  .issued-by-block span { display: block; }
  .issued-by-block strong { font-size: 7.5pt; color: #aaa; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-block-end: 2pt; }
  .computer-generated { font-size: 7.5pt; color: #aaa; text-align: center; margin: 0; }
  h1 { font-size: 16pt; margin-block-end: 2pt; }
  .company-name { font-weight: 600; font-size: 11pt; margin-block-end: 10pt; }
  .company-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10pt; margin-block-end: 10pt; }
  .company-head .company-name { margin: 0; }
  .seller-details { flex-basis: 100%; }
  .seller-details span { font-size: 8pt; color: #555; display: block; line-height: 1.5; }
  .company-logo { max-height: 16mm; max-width: 42mm; object-fit: contain; }
  .subtitle { color: #555; margin-block-end: 14pt; }
  h2 { font-size: 12pt; margin-block: 14pt 6pt; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 4pt; }
  th, td { border: 1px solid #ccc; padding: 5pt 8pt; text-align: start; }
  th { background: #f4f5fb; font-weight: 600; }
  td.amount, th.amount { text-align: end; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 600; background: #fafafa; }
  .grand-total { margin-block-start: 10pt; font-weight: 700; font-size: 11pt; }
  .amount-words { margin-block-start: 6pt; font-weight: 600; }
  ${params.extraCss ?? ""}
</style>
</head>
<body>
<div class="report-main">
<div class="company-head">${params.logoDataUri ? `<img class="company-logo" src="${escapeHtml(params.logoDataUri)}" alt="" />` : ""}<p class="company-name">${escapeHtml(params.companyName)}</p>${(params.sellerDetailLines ?? []).length > 0 ? `<div class="seller-details">${(params.sellerDetailLines ?? []).map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</div>` : ""}</div>
<h1>${escapeHtml(params.title)}</h1>
${params.subtitle ? `<p class="subtitle">${escapeHtml(params.subtitle)}</p>` : ""}
${params.bodyHtml}
</div>
${params.footerHtml ? `<div class="report-footer-block">${params.footerHtml}</div>` : ""}
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
