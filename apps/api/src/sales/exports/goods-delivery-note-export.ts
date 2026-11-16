import { issuedFooter } from "../../documents/document-issued-footer.js";
import { renderPartyDocumentDetails, type PartyDocumentDetails } from "../../documents/party-document-details.js";
import type { GoodsDeliveryNoteDetail } from "@erp/core";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable storekeeper handover record, in Arabic (RTL) or English (LTR). No prices, no
// amounts (docs/01-OPEN-DECISIONS.md E1) — just the sales order, the items and quantities, and
// three signature spaces: the storekeeper's (blank, the app has no e-signature capability), and
// the typed driver and receiver names.
export async function goodsDeliveryNoteToPdfHtml(params: {
  readonly note: GoodsDeliveryNoteDetail;
  readonly customerDetails?: PartyDocumentDetails | null;
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
  const { note } = params;
  const customer = params.language === "ar" && note.customerNameAr ? note.customerNameAr : note.customerName;
  const title = t("deliveryNote.title");

  const lineRows = note.lines
    .map((l) => {
      const itemLabel = params.language === "ar" && l.itemNameAr ? l.itemNameAr : (l.itemName ?? l.description);
      return `<tr><td>${escapeHtml(itemLabel)}</td><td class="amount">${escapeHtml(Number(l.quantity).toString())}</td></tr>`;
    })
    .join("");

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("deliveryNote.number"), note.number],
    [t("deliveryNote.date"), note.deliveryDate],
    [t("deliveryNote.salesOrder"), note.salesOrderNumber],
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
  .no-prices-notice { font-size: 8pt; color: #888; margin-block-start: 6pt; font-style: italic; }
  .inv-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
  .signature-block { display: flex; gap: 16pt; margin-block-start: 28pt; }
  .signature-cell { flex: 1 1 0; text-align: center; }
  .signature-label { font-size: 8pt; color: #666; margin-block-end: 2pt; }
  .signature-value { font-size: 9.5pt; font-weight: 600; min-height: 14pt; }
  .signature-line { border-block-start: 1px solid #333; margin-block-start: 22pt; padding-block-start: 4pt; }
  `;

  const driverRow = note.driverName ? `<div class="signature-value">${escapeHtml(note.driverName)}</div>` : `<div class="signature-value">&nbsp;</div><div class="signature-line"></div>`;
  const receiverRow = note.receiverName ? `<div class="signature-value">${escapeHtml(note.receiverName)}</div>` : `<div class="signature-value">&nbsp;</div><div class="signature-line"></div>`;

  return renderReportShell({
    language: params.language,
    documentTitle: `${title} ${note.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title,
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="inv-header">
  <div class="bill-to-block">
    <p class="bill-to-label">${escapeHtml(t("deliveryNote.to"))}</p>
    <span class="bill-to-name">${escapeHtml(customer)}</span>
    ${await renderPartyDocumentDetails(params.customerDetails, params.language)}
  </div>
  <table class="inv-meta">${metaRows}</table>
</div>
<table class="inv-lines">
<thead><tr><th>${escapeHtml(t("deliveryNote.description"))}</th><th class="amount">${escapeHtml(t("deliveryNote.quantity"))}</th></tr></thead>
<tbody>${lineRows}</tbody>
</table>
<p class="no-prices-notice">${escapeHtml(t("deliveryNote.noPrices"))}</p>
${note.notes ? `<p class="inv-notes">${escapeHtml(t("deliveryNote.notes"))}: ${escapeHtml(note.notes)}</p>` : ""}
<div class="signature-block">
  <div class="signature-cell"><p class="signature-label">${escapeHtml(t("deliveryNote.storekeeperSignature"))}</p><div class="signature-value">&nbsp;</div><div class="signature-line"></div></div>
  <div class="signature-cell"><p class="signature-label">${escapeHtml(t("deliveryNote.driverName"))}</p>${driverRow}</div>
  <div class="signature-cell"><p class="signature-label">${escapeHtml(t("deliveryNote.receiverName"))}</p>${receiverRow}</div>
</div>`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("deliveryNote.computerGenerated") }),
  });
}
