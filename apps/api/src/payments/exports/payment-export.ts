import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { PaymentDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable receipt or supplier payment voucher, in Arabic (RTL) or English (LTR).
// Not a ZATCA e-document; that is handled by the compliance pack.
export async function paymentToPdfHtml(params: {
  readonly payment: PaymentDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly issuedBy?: string | null;
  readonly issuedAt?: string | null;
  readonly logoDataUri?: string | undefined;
  readonly sellerVatNumber?: string | null;
  readonly sellerCrNumber?: string | null;
  readonly sellerAddress?: string | null;
  readonly sellerPhone?: string | null;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { payment } = params;
  const cur = payment.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);

  const isReceipt = payment.direction === "RECEIPT";
  const title = t(isReceipt ? "payment.receiptTitle" : "payment.paymentTitle");
  const partyLabel = t(isReceipt ? "payment.customer" : "payment.supplier");
  const partyName =
    params.language === "ar" && payment.partyNameAr ? payment.partyNameAr : payment.partyName;
  const cashAccountName =
    params.language === "ar" && payment.cashAccountNameAr ? payment.cashAccountNameAr : payment.cashAccountName;

  // Seller identity shown under the company name in the shared header shell.
  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("payment.number"), payment.number],
    [t("payment.date"), payment.paymentDate],
    [t("payment.method"), t(`payment.methods.${payment.method}`)],
    [t("payment.bankAccount"), `${payment.cashAccountCode} — ${cashAccountName}`],
    ...(payment.reference ? [[t("payment.reference"), payment.reference]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const allocationRows = payment.allocations
    .map((a) => `<tr><td>${escapeHtml(a.invoiceNumber)}</td><td class="amount">${money(a.amount)}</td></tr>`)
    .join("");

  const extraCss = `
  .pmt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; margin-block-end: 18pt; }
  .pmt-party-block { flex: 1 1 auto; }
  .pmt-party-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-block-end: 4pt; font-weight: 600; }
  .pmt-party-name { font-weight: 700; font-size: 11pt; display: block; }
  table.pmt-meta { width: auto; border: none; }
  table.pmt-meta th, table.pmt-meta td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.pmt-meta th { color: #666; font-weight: 400; }
  table.pmt-meta td { font-weight: 600; text-align: end; }
  table.pmt-lines { margin-block-start: 2pt; }
  table.pmt-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.pmt-lines td { font-size: 9pt; }
  table.pmt-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .pmt-totals-wrap { display: flex; justify-content: flex-end; margin-block-start: 8pt; }
  table.pmt-totals { width: 42%; border: none; }
  table.pmt-totals th, table.pmt-totals td { border: none; border-block-end: 1px solid #e8e8e8; padding: 4pt 8pt; font-size: 9.5pt; background: none; }
  table.pmt-totals .grand-total th, table.pmt-totals .grand-total td { border-block-end: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .amount-words { margin-block-start: 10pt; padding: 6pt 10pt; background: #f4f5fb; border-inline-start: 3pt solid #1a1a1a; font-size: 9.5pt; font-weight: 600; }
  .pmt-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
  .pmt-footer { margin-block-start: 24pt; padding-block-start: 6pt; border-block-start: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; }
  `;

  const allocationsSection =
    payment.allocations.length > 0
      ? `<h3 style="font-size:10pt; margin-block: 14pt 4pt;">${escapeHtml(t("payment.settledInvoices"))}</h3>
<table class="pmt-lines">
<thead><tr><th>${escapeHtml(t("payment.invoiceNumber"))}</th><th class="amount">${escapeHtml(t("payment.invoiceAmount"))}</th></tr></thead>
<tbody>${allocationRows}</tbody>
</table>`
      : "";

  return renderReportShell({
    language: params.language,
    documentTitle: `${title} ${payment.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title,
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="pmt-header">
  <div class="pmt-party-block">
    <p class="pmt-party-label">${escapeHtml(partyLabel)}</p>
    <span class="pmt-party-name">${escapeHtml(partyName)}</span>
  </div>
  <table class="pmt-meta">${metaRows}</table>
</div>
${allocationsSection}
<div class="pmt-totals-wrap">
  <table class="pmt-totals">
    <tr><th>${escapeHtml(t("payment.settled"))}</th><td class="amount">${money(payment.allocated)}</td></tr>
    <tr><th>${escapeHtml(t("payment.onAccount"))}</th><td class="amount">${money(payment.unallocated)}</td></tr>
    <tr class="grand-total"><th>${escapeHtml(t("payment.total"))}</th><td class="amount">${money(payment.amount)}</td></tr>
  </table>
</div>
<p class="amount-words">${escapeHtml(t("payment.inWords"))}: ${escapeHtml(tafqeetAmount(payment.amount, cur))}</p>
${payment.notes ? `<p class="pmt-notes">${escapeHtml(payment.notes)}</p>` : ""}`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("payment.computerGenerated") }),
  });
}
