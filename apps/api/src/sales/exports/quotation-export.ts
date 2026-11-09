import type { QuotationDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable quotation, in Arabic (RTL) or English (LTR). Not a ZATCA document — a quotation
// never reaches the compliance pack, only an eventual sales invoice does.
export async function quotationToPdfHtml(params: {
  readonly quotation: QuotationDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
  readonly sellerVatNumber?: string | null;
  readonly sellerCrNumber?: string | null;
  readonly sellerAddress?: string | null;
  readonly sellerPhone?: string | null;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { quotation } = params;
  const cur = quotation.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const customer = params.language === "ar" && quotation.customerNameAr ? quotation.customerNameAr : quotation.customerName;
  const title = t("quotation.title");

  const lineRows = quotation.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.description)}</td><td class="amount">${escapeHtml(Number(l.quantity).toString())}</td><td class="amount">${money(l.unitPrice)}</td><td class="amount">${money(l.netAmount)}</td><td class="amount">${escapeHtml(Number(l.taxRate).toString())}%</td><td class="amount">${money(l.taxAmount)}</td></tr>`,
    )
    .join("");

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("quotation.number"), quotation.number],
    [t("quotation.date"), quotation.quotationDate],
    ...(quotation.validUntil ? [[t("quotation.validUntil"), quotation.validUntil]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const extraCss = `
  .inv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; margin-block-end: 18pt; }
  .bill-to-block { flex: 1 1 auto; }
  .bill-to-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-block-end: 4pt; font-weight: 600; }
  .bill-to-name { font-weight: 700; font-size: 11pt; display: block; margin-block-end: 2pt; }
  table.inv-meta { width: auto; border: none; }
  table.inv-meta th, table.inv-meta td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.inv-meta th { color: #666; font-weight: 400; }
  table.inv-meta td { font-weight: 600; text-align: end; }
  table.inv-lines { margin-block-start: 2pt; }
  table.inv-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.inv-lines td { font-size: 9pt; }
  table.inv-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-block-start: 8pt; }
  table.inv-totals { width: 42%; border: none; }
  table.inv-totals th, table.inv-totals td { border: none; border-block-end: 1px solid #e8e8e8; padding: 4pt 8pt; font-size: 9.5pt; background: none; }
  table.inv-totals .grand-total th, table.inv-totals .grand-total td { border-block-end: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .amount-words { margin-block-start: 10pt; padding: 6pt 10pt; background: #f4f5fb; border-inline-start: 3pt solid #1a1a1a; font-size: 9.5pt; font-weight: 600; }
  .inv-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
  .inv-footer { margin-block-start: 24pt; padding-block-start: 6pt; border-block-start: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${title} ${quotation.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title,
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="inv-header">
  <div class="bill-to-block">
    <p class="bill-to-label">${escapeHtml(t("quotation.to"))}</p>
    <span class="bill-to-name">${escapeHtml(customer)}</span>
  </div>
  <table class="inv-meta">${metaRows}</table>
</div>
<table class="inv-lines">
<thead><tr><th>${escapeHtml(t("quotation.description"))}</th><th class="amount">${escapeHtml(t("quotation.quantity"))}</th><th class="amount">${escapeHtml(t("quotation.unitPrice"))}</th><th class="amount">${escapeHtml(t("quotation.net"))}</th><th class="amount">${escapeHtml(t("quotation.taxRate"))}</th><th class="amount">${escapeHtml(t("quotation.tax"))}</th></tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="inv-totals">
    <tr><th>${escapeHtml(t("quotation.net"))}</th><td class="amount">${money(quotation.totalNet)}</td></tr>
    <tr><th>${escapeHtml(t("quotation.tax"))}</th><td class="amount">${money(quotation.totalTax)}</td></tr>
    <tr class="grand-total"><th>${escapeHtml(t("quotation.total"))}</th><td class="amount">${money(quotation.totalGross)}</td></tr>
  </table>
</div>
<p class="amount-words">${escapeHtml(t("quotation.inWords"))}: ${escapeHtml(tafqeetAmount(quotation.totalGross, cur))}</p>
${quotation.notes ? `<p class="inv-notes">${escapeHtml(quotation.notes)}</p>` : ""}
<div class="inv-footer">${escapeHtml(t("quotation.computerGenerated"))}</div>`,
  });
}
