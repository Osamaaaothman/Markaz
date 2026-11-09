import type { SalesInvoiceDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable invoice, credit note or debit note, in Arabic (RTL) or English (LTR). It shows the figures as posted.
// It is NOT a ZATCA e-invoice: no UUID, hash, QR or signature — those come from the compliance pack (M7).
export async function salesInvoiceToPdfHtml(params: {
  readonly invoice: SalesInvoiceDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
  readonly sellerVatNumber?: string | null;
  readonly sellerCrNumber?: string | null;
  readonly sellerAddress?: string | null;
  readonly sellerPhone?: string | null;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { invoice } = params;
  const cur = invoice.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const customer = params.language === "ar" && invoice.customerNameAr ? invoice.customerNameAr : invoice.customerName;
  const title = t(
    invoice.documentType === "INVOICE" ? "salesInvoice.invoiceTitle" : invoice.documentType === "DEBIT_NOTE" ? "salesInvoice.debitNoteTitle" : "salesInvoice.creditNoteTitle",
  );

  const lineRows = invoice.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.description)}</td><td class="amount">${escapeHtml(Number(l.quantity).toString())}</td><td class="amount">${money(l.unitPrice)}</td><td class="amount">${money(l.netAmount)}</td><td class="amount">${escapeHtml(Number(l.taxRate).toString())}%</td><td class="amount">${money(l.taxAmount)}</td></tr>`,
    )
    .join("");

  const sep = params.language === "ar" ? "، " : ", ";
  const addressParts = [invoice.customerStreetName, invoice.customerAdditionalStreetName, invoice.customerDistrict, invoice.customerCity, invoice.customerPostalCode].filter(
    (p): p is string => Boolean(p?.trim()),
  );
  const buildingPart = [invoice.customerBuildingNumber, invoice.customerAdditionalNumber].filter((p): p is string => Boolean(p?.trim())).join("-");
  const fullAddress = [buildingPart, ...addressParts].filter(Boolean).join(sep).trim();

  // Seller identity shown under the company name in the shared header shell.
  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("salesInvoice.number"), invoice.number],
    [t("salesInvoice.date"), invoice.invoiceDate],
    ...(invoice.dueDate ? [[t("salesInvoice.dueDate"), invoice.dueDate]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const billToLines = [
    `<span class="bill-to-name">${escapeHtml(customer)}</span>`,
    ...(invoice.customerVatNumber ? [`<span>${escapeHtml(t("salesInvoice.customerVatNumber"))}: ${escapeHtml(invoice.customerVatNumber)}</span>`] : []),
    ...(invoice.customerCommercialRegistration ? [`<span>${escapeHtml(t("salesInvoice.customerCr"))}: ${escapeHtml(invoice.customerCommercialRegistration)}</span>`] : []),
    ...(fullAddress ? [`<span>${escapeHtml(fullAddress)}</span>`] : []),
  ].join("<br/>");

  const extraCss = `
  .inv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; margin-block-end: 18pt; }
  .bill-to-block { flex: 1 1 auto; }
  .bill-to-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-block-end: 4pt; font-weight: 600; }
  .bill-to-name { font-weight: 700; font-size: 11pt; display: block; margin-block-end: 2pt; }
  .bill-to-block span { font-size: 8.5pt; color: #444; display: block; line-height: 1.6; }
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
    documentTitle: `${title} ${invoice.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title,
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="inv-header">
  <div class="bill-to-block">
    <p class="bill-to-label">${escapeHtml(t("salesInvoice.billTo"))}</p>
    ${billToLines}
  </div>
  <table class="inv-meta">${metaRows}</table>
</div>
<table class="inv-lines">
<thead><tr><th>${escapeHtml(t("salesInvoice.description"))}</th><th class="amount">${escapeHtml(t("salesInvoice.quantity"))}</th><th class="amount">${escapeHtml(t("salesInvoice.unitPrice"))}</th><th class="amount">${escapeHtml(t("salesInvoice.net"))}</th><th class="amount">${escapeHtml(t("salesInvoice.taxRate"))}</th><th class="amount">${escapeHtml(t("salesInvoice.tax"))}</th></tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="inv-totals">
    <tr><th>${escapeHtml(t("salesInvoice.net"))}</th><td class="amount">${money(invoice.totalNet)}</td></tr>
    <tr><th>${escapeHtml(t("salesInvoice.tax"))}</th><td class="amount">${money(invoice.totalTax)}</td></tr>
    <tr class="grand-total"><th>${escapeHtml(t("salesInvoice.total"))}</th><td class="amount">${money(invoice.totalGross)}</td></tr>
  </table>
</div>
<p class="amount-words">${escapeHtml(t("salesInvoice.inWords"))}: ${escapeHtml(tafqeetAmount(invoice.totalGross, cur))}</p>
${invoice.notes ? `<p class="inv-notes">${escapeHtml(invoice.notes)}</p>` : ""}
<div class="inv-footer">${escapeHtml(t("salesInvoice.computerGenerated"))}</div>`,
  });
}
