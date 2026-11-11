import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { SupplierInvoiceDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function supplierInvoiceToPdfHtml(params: {
  readonly invoice: SupplierInvoiceDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
  readonly sellerVatNumber?: string | null;
  readonly sellerCrNumber?: string | null;
  readonly sellerAddress?: string | null;
  readonly sellerPhone?: string | null;
  readonly issuedBy?: string | null;
  readonly issuedAt?: string | null;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { invoice } = params;
  const cur = invoice.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const supplier = params.language === "ar" && invoice.supplierNameAr ? invoice.supplierNameAr : invoice.supplierName;
  const title = t(invoice.documentType === "DEBIT_NOTE" ? "supplierInvoice.debitNoteTitle" : "supplierInvoice.invoiceTitle");

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("supplierInvoice.number"), invoice.number],
    ...(invoice.supplierInvoiceNumber ? [[t("supplierInvoice.supplierInvoiceNumber"), invoice.supplierInvoiceNumber]] : []),
    [t("supplierInvoice.date"), invoice.invoiceDate],
    ...(invoice.dueDate ? [[t("supplierInvoice.dueDate"), invoice.dueDate]] : []),
    ...(invoice.purchaseOrderNumber ? [[t("purchaseOrder.title"), invoice.purchaseOrderNumber]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = invoice.lines
    .map((l) => {
      const label =
        l.kind === "EXPENSE"
          ? escapeHtml(l.description ?? (params.language === "ar" && l.accountNameAr ? l.accountNameAr : (l.accountName ?? "")))
          : escapeHtml(params.language === "ar" && l.itemNameAr ? l.itemNameAr : (l.itemName ?? ""));
      return `<tr>
        <td>${label}</td>
        <td class="amount">${escapeHtml(Number(l.quantity).toString())}</td>
        <td class="amount">${money(l.unitPrice)}</td>
        <td class="amount">${money(l.netAmount)}</td>
        <td class="amount">${escapeHtml(Number(l.taxRate).toString())}%</td>
        <td class="amount">${money(l.taxAmount)}</td>
      </tr>`;
    })
    .join("");

  const extraCss = `
  .sinv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; margin-block-end: 18pt; }
  .bill-from-block { flex: 1 1 auto; }
  .bill-from-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-block-end: 4pt; font-weight: 600; }
  .bill-from-name { font-weight: 700; font-size: 11pt; display: block; margin-block-end: 2pt; }
  table.sinv-meta { width: auto; border: none; }
  table.sinv-meta th, table.sinv-meta td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.sinv-meta th { color: #666; font-weight: 400; }
  table.sinv-meta td { font-weight: 600; text-align: end; }
  table.sinv-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.sinv-lines td { font-size: 9pt; }
  table.sinv-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: right; margin-block-start: 8pt; }
  table.sinv-totals { width: 42%; border: none; }
  table.sinv-totals th, table.sinv-totals td { border: none; border-block-end: 1px solid #e8e8e8; padding: 4pt 8pt; font-size: 9.5pt; background: none; }
  table.sinv-totals .grand-total th, table.sinv-totals .grand-total td { border-block-end: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .amount-words { margin-block-start: 10pt; padding: 6pt 10pt; background: #f4f5fb; border-inline-start: 3pt solid #1a1a1a; font-size: 9.5pt; font-weight: 600; }
  .sinv-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
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
<div class="sinv-header">
  <div class="bill-from-block">
    <p class="bill-from-label">${escapeHtml(t("supplierInvoice.billFrom"))}</p>
    <span class="bill-from-name">${escapeHtml(supplier)}</span>
  </div>
  <table class="sinv-meta">${metaRows}</table>
</div>
<table class="sinv-lines">
<thead><tr>
  <th>${escapeHtml(t("supplierInvoice.item"))}</th>
  <th class="amount">${escapeHtml(t("supplierInvoice.qty"))}</th>
  <th class="amount">${escapeHtml(t("supplierInvoice.unitPrice"))}</th>
  <th class="amount">${escapeHtml(t("supplierInvoice.net"))}</th>
  <th class="amount">${escapeHtml(t("supplierInvoice.taxRate"))}</th>
  <th class="amount">${escapeHtml(t("supplierInvoice.tax"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="sinv-totals">
    <tr><th>${escapeHtml(t("supplierInvoice.totalNet"))}</th><td class="amount">${money(invoice.totalNet)}</td></tr>
    <tr><th>${escapeHtml(t("supplierInvoice.totalTax"))}</th><td class="amount">${money(invoice.totalTax)}</td></tr>
    <tr class="grand-total"><th>${escapeHtml(t("supplierInvoice.grandTotal"))}</th><td class="amount">${money(invoice.totalGross)}</td></tr>
  </table>
</div>
<p class="amount-words">${escapeHtml(t("salesInvoice.inWords"))}: ${escapeHtml(tafqeetAmount(invoice.totalGross, cur))}</p>
${invoice.notes ? `<p class="sinv-notes">${escapeHtml(invoice.notes)}</p>` : ""}`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("supplierInvoice.computerGenerated") }),
  });
}
