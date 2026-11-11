import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { GoodsReceiptDetail } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function goodsReceiptToPdfHtml(params: {
  readonly receipt: GoodsReceiptDetail;
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
  const { receipt } = params;
  const cur = receipt.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const supplier = receipt.partyId
    ? escapeHtml(params.language === "ar" && receipt.partyNameAr ? receipt.partyNameAr : (receipt.partyName ?? ""))
    : "";
  const warehouse = params.language === "ar" && receipt.warehouseNameAr ? receipt.warehouseNameAr : receipt.warehouseName;

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("goodsReceipt.number"), receipt.number],
    [t("goodsReceipt.date"), receipt.documentDate],
    ...(supplier ? [[t("goodsReceipt.supplier"), supplier]] : []),
    [t("goodsReceipt.warehouse"), warehouse],
    ...(receipt.purchaseOrderNumber ? [[t("goodsReceipt.purchaseOrder"), receipt.purchaseOrderNumber]] : []),
    ...(receipt.reference ? [[t("goodsReceipt.reference"), receipt.reference]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = receipt.lines
    .map((l) => {
      const item = params.language === "ar" && l.itemNameAr ? l.itemNameAr : l.itemName;
      return `<tr>
        <td>${escapeHtml(l.itemCode)}</td>
        <td>${escapeHtml(item)}</td>
        <td>${escapeHtml(l.unit)}</td>
        <td class="amount">${escapeHtml(Number(l.quantity).toString())}</td>
        <td class="amount">${money(l.unitCost)}</td>
        <td class="amount">${money(l.value)}</td>
      </tr>`;
    })
    .join("");

  const extraCss = `
  .rec-meta { display: flex; justify-content: flex-end; margin-block-end: 14pt; }
  table.rec-meta-table { width: auto; border: none; }
  table.rec-meta-table th, table.rec-meta-table td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.rec-meta-table th { color: #666; font-weight: 400; }
  table.rec-meta-table td { font-weight: 600; text-align: end; }
  table.rec-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.rec-lines td { font-size: 9pt; }
  table.rec-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-block-start: 8pt; }
  table.rec-total { width: 42%; border: none; }
  table.rec-total tr td, table.rec-total tr th { border: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .rec-issued-by { margin-block-start: 16pt; padding: 6pt 10pt; border: 1px solid #e8e8e8; border-radius: 4pt; font-size: 8pt; color: #555; display: flex; gap: 24pt; }
  .rec-issued-by strong { font-size: 7.5pt; color: #aaa; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-block-end: 2pt; }
  .rec-footer { margin-block-start: 24pt; padding-block-start: 6pt; border-block-start: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("goodsReceipt.title")} ${receipt.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("goodsReceipt.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="rec-meta"><table class="rec-meta-table">${metaRows}</table></div>
<table class="rec-lines">
<thead><tr>
  <th>${escapeHtml(t("goodsReceipt.item"))}</th>
  <th>${escapeHtml(t("goodsReceipt.item"))}</th>
  <th>${escapeHtml(t("goodsReceipt.unit"))}</th>
  <th class="amount">${escapeHtml(t("goodsReceipt.qty"))}</th>
  <th class="amount">${escapeHtml(t("goodsReceipt.unitCost"))}</th>
  <th class="amount">${escapeHtml(t("goodsReceipt.value"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="rec-total">
    <tr><th>${escapeHtml(t("goodsReceipt.total"))}</th><td class="amount">${money(receipt.totalValue)}</td></tr>
  </table>
</div>`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("goodsReceipt.computerGenerated") }),
  });
}
