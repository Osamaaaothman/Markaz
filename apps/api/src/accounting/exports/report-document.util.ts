import { Money } from "@erp/shared";
import { escapeHtml } from "../../common/html-escape.js";
import type { SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export function renderCompanyLetterhead(params: {
  readonly companyName: string;
  readonly logoDataUri?: string;
  readonly sellerDetailLines?: readonly string[];
}): string {
  const logo = params.logoDataUri?.match(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) ? params.logoDataUri : null;
  return `<header class="company-head"><div class="company-identity"><p class="company-name">${escapeHtml(params.companyName)}</p><div class="seller-details">${(params.sellerDetailLines ?? []).filter((line) => line.trim()).map((line) => `<span>${escapeHtml(line).replace(/(\+?\d[\d -]{6,}\d)/g, '<bdi dir="ltr">$1</bdi>')}</span>`).join("")}</div></div>${logo ? `<img class="company-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(params.companyName)}" />` : ""}</header>`;
}

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
  // "classic" (default) keeps every existing report/voucher/invoice PDF exactly as it is.
  // "clean" is an opt-in, purely visual skin — flat neutral borders instead of the dark-green
  // table headers — scoped under .doc-clean so it never touches a caller that omits it.
  readonly variant?: "classic" | "clean";
}): string {
  const dir = params.language === "ar" ? "rtl" : "ltr";
  const variant = params.variant ?? "classic";
  return `<!doctype html>
<html lang="${params.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(params.documentTitle)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body {
    font-family: "Segoe UI", "Noto Sans Arabic", sans-serif;
    color: #24352e;
    margin: 0;
    font-size: 9pt;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report-main { display: block; }
  .report-footer-block { padding-block-start: 8pt; border-block-start: 1px solid #ddd; }
  .issued-by-block { padding: 6pt 10pt; border: 1px solid #e8e8e8; border-radius: 4pt; font-size: 8pt; color: #555; display: flex; gap: 24pt; margin-block-end: 10pt; }
  .issued-by-block span { display: block; }
  .issued-by-block strong { font-size: 7.5pt; color: #777; font-weight: 400; display: block; margin-block-end: 2pt; }
  .computer-generated { font-size: 7.5pt; color: #aaa; text-align: center; margin: 0; }
  h1 { font-size: 19pt; color: #244f43; margin-block: 0 4pt; line-height: 1.4; }
  .company-head { display: flex; justify-content: space-between; align-items: center; gap: 22pt; padding-block-end: 14pt; margin-block-end: 17pt; border-block-end: 2pt solid #244f43; break-inside: avoid; }
  .company-identity { flex: 1; min-width: 0; }
  .company-head .company-name { margin: 0 0 5pt; font-size: 16pt; font-weight: 700; line-height: 1.45; overflow-wrap: anywhere; }
  .seller-details { display: flex; flex-wrap: wrap; gap: 2pt 14pt; }
  .seller-details span { font-size: 8pt; color: #52645b; line-height: 1.6; overflow-wrap: anywhere; }
  .seller-details span:nth-child(n+3) { flex-basis: 100%; }
  .company-logo { width: 32mm; height: 25mm; object-fit: contain; flex-shrink: 0; }
  .subtitle { color: #64716c; margin-block: 0 14pt; }
  h2 { font-size: 12pt; margin-block: 14pt 6pt; }
  table { width: 100%; border-collapse: collapse; margin-block-end: 4pt; }
  th, td { border: 1px solid #dbe3de; padding: 6pt 7pt; text-align: start; vertical-align: top; }
  th { background: #edf3ef; color: #244f43; font-weight: 600; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  td { overflow-wrap: anywhere; }
  td.amount, th.amount { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total-row td { font-weight: 600; background: #fafafa; }
  .grand-total { margin-block-start: 10pt; font-weight: 700; font-size: 11pt; }
  .amount-words { margin-block-start: 6pt; font-weight: 600; }
  ${params.extraCss ?? ""}
  /* One visual language for the existing invoice, voucher and report templates. */
  .report-main .inv-header { gap: 18pt; margin-block: 12pt 15pt; align-items: stretch; break-inside: avoid; }
  .report-main .bill-to-block { border: 1px solid #dbe3de; border-radius: 5pt; padding: 10pt 12pt; flex: 1; min-width: 0; }
  .report-main .bill-to-label { margin: 0 0 5pt; color: #52645b; font-size: 8pt; letter-spacing: 0; }
  .report-main .bill-to-name { font-size: 11pt; color: #24352e; margin-block-end: 4pt; }
  .report-main .bill-to-block span { line-height: 1.65; }
  .report-main .inv-meta { min-width: 34%; margin: 0; align-self: start; }
  .report-main .inv-meta th, .report-main .inv-meta td { padding: 5pt 7pt; white-space: normal; overflow-wrap: anywhere; }
  .report-main table.inv-lines th { background: #244f43; border-color: #244f43; color: white; padding-block: 8pt; font-size: 8.5pt; }
  .report-main table.inv-lines td { border-color: #dbe3de; padding-block: 7pt; font-size: 8.5pt; }
  .report-main table.inv-lines tbody tr:nth-child(even) td { background: #f6f8f6; }
  .report-main .totals-wrap { margin-block-start: 12pt; break-inside: avoid; }
  .report-main table.inv-totals { width: 46%; }
  .report-main table.inv-totals .grand-total th, .report-main table.inv-totals .grand-total td { background: #244f43; color: white; padding: 8pt; }
  .report-main .amount-words { padding: 9pt 11pt; background: #f3f6f4; border-inline-start: 2pt solid #244f43; font-size: 9pt; font-weight: 500; break-inside: avoid; }
  .report-main .inv-notes { white-space: pre-line; color: #52645b; }
  .report-main .invoice-compliance { padding-block-start: 12pt; border-block-start: 1px solid #dbe3de; }
  .report-main .invoice-qr { width: 112pt; height: 112pt; flex-shrink: 0; }
  .report-main .compliance-notice { font-size: 8pt; border-width: 1pt; border-radius: 4pt; }
  .report-main table[class$="-lines"] th { background: #244f43; border-color: #244f43; color: #fff; padding-block: 8pt; }
  .report-main table[class$="-lines"] td { border-color: #dbe3de; padding-block: 7pt; }
  .report-main table[class$="-lines"] tbody tr:nth-child(even) td { background: #f6f8f6; }
  .report-main table[class$="-totals"] .grand-total th, .report-main table[class$="-totals"] .grand-total td { background: #244f43; color: #fff; padding: 8pt; }
      .report-main table.rec-total th, .report-main table.rec-total td { background: #244f43; padding: 8pt; }
  .report-main .sinv-header { break-inside: avoid; }
  .report-main .bill-from-block { border: 1px solid #dbe3de; padding: 10pt 12pt; border-radius: 5pt; }
  .party-detail { display: block; font-size: 8.5pt; line-height: 1.7; overflow-wrap: anywhere; color: #52645b; }
  /* ---- "clean" skin: flat neutral palette, thin borders, no colored fills ---- */
  .doc-clean { color: #1c1d21; }
  .doc-clean h1 { color: #1c1d21; font-size: 17pt; }
  .doc-clean .company-head { border-block-end: 1px solid #e3e4e8; }
  .doc-clean .company-head .company-name { color: #1c1d21; }
  .doc-clean .seller-details span { color: #8b8d93; }
  .doc-clean .subtitle { color: #8b8d93; }
  .doc-clean .bill-to-block, .doc-clean .bill-from-block { border-color: #e3e4e8; }
  .doc-clean .bill-to-label { color: #8b8d93; }
  .doc-clean .bill-to-name { color: #1c1d21; }
  .doc-clean table.inv-meta th { color: #8b8d93; }
  .doc-clean table.inv-meta td { color: #1c1d21; }
  .doc-clean table[class$="-lines"] th, .doc-clean table.inv-lines th {
    background: #fff; color: #8b8d93; border-color: #e3e4e8; font-weight: 600; border-block-end: 1px solid #1c1d21;
  }
  .doc-clean table[class$="-lines"] td, .doc-clean table.inv-lines td { border-color: #eef0f3; background: #fff; }
  .doc-clean table[class$="-lines"] tbody tr:nth-child(even) td, .doc-clean table.inv-lines tbody tr:nth-child(even) td { background: #fff; }
  .doc-clean table[class$="-totals"] th, .doc-clean table[class$="-totals"] td,
  .doc-clean table.inv-totals th, .doc-clean table.inv-totals td { background: #fff; color: #1c1d21; border-color: #eef0f3; }
  .doc-clean table[class$="-totals"] .grand-total th, .doc-clean table[class$="-totals"] .grand-total td,
  .doc-clean table.inv-totals .grand-total th, .doc-clean table.inv-totals .grand-total td {
    background: #fff; color: #1c1d21; border-block-start: 1.5pt solid #1c1d21; border-block-end: none; font-size: 11pt;
  }
  .doc-clean table.rec-total th, .doc-clean table.rec-total td { background: #fff; color: #1c1d21; }
  .doc-clean .amount-words { background: #f7f7f9; border-inline-start-color: #1c1d21; color: #1c1d21; }
  .doc-clean .invoice-compliance { border-block-start: 1px solid #e3e4e8; }
  .doc-clean .invoice-qr { width: 100pt; height: 100pt; }
  .doc-clean .zatca-caption { font-size: 7.5pt; color: #8b8d93; line-height: 1.5; margin-block-start: 5pt; }
  .doc-clean .zatca-caption .en { direction: ltr; display: block; }
</style>
</head>
<body>
<div class="report-main${variant === "clean" ? " doc-clean" : ""}">
${renderCompanyLetterhead(params)}
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
