import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { PurchaseOrderDetail } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function purchaseOrderToPdfHtml(params: {
  readonly order: PurchaseOrderDetail;
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
  const { order } = params;
  const cur = order.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const supplier = params.language === "ar" && order.supplierNameAr ? order.supplierNameAr : order.supplierName;
  const warehouse = params.language === "ar" && order.warehouseNameAr ? order.warehouseNameAr : order.warehouseName;

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("purchaseOrder.number"), order.number],
    [t("purchaseOrder.date"), order.orderDate],
    ...(order.expectedDate ? [[t("purchaseOrder.expectedDate"), order.expectedDate]] : []),
    [t("purchaseOrder.supplier"), supplier],
    ...(warehouse ? [[t("purchaseOrder.warehouse"), warehouse]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = order.lines
    .map((l) => {
      const item = params.language === "ar" && l.itemNameAr ? l.itemNameAr : l.itemName;
      return `<tr>
        <td>${escapeHtml(l.itemCode)}</td>
        <td>${escapeHtml(item)}</td>
        <td>${escapeHtml(l.unit)}</td>
        <td class="amount">${escapeHtml(Number(l.quantity).toString())}</td>
        <td class="amount">${money(l.unitPrice)}</td>
        <td class="amount">${l.taxRate ? escapeHtml(Number(l.taxRate).toString()) + "%" : "—"}</td>
        <td class="amount">${money(l.lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const totalNet = Money.of(order.totalAmount, cur).subtract(Money.of(order.totalTax, cur));

  const extraCss = `
  .po-meta { display: flex; justify-content: right; margin-block-end: 14pt; }
  table.po-meta-table { width: auto; border: none; }
  table.po-meta-table th, table.po-meta-table td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.po-meta-table th { color: #666; font-weight: 400; }
  table.po-meta-table td { font-weight: 600; text-align: end; }
  table.po-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.po-lines td { font-size: 9pt; }
  table.po-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: right; margin-block-start: 8pt; }
  table.po-totals { width: 42%; border: none; }
  table.po-totals th, table.po-totals td { border: none; border-block-end: 1px solid #e8e8e8; padding: 4pt 8pt; font-size: 9.5pt; background: none; }
  table.po-totals .grand-total th, table.po-totals .grand-total td { border-block-end: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .po-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("purchaseOrder.title")} ${order.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("purchaseOrder.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="po-meta"><table class="po-meta-table">${metaRows}</table></div>
<table class="po-lines">
<thead><tr>
  <th>${escapeHtml(t("purchaseOrder.code"))}</th>
  <th>${escapeHtml(t("purchaseOrder.item"))}</th>
  <th>${escapeHtml(t("purchaseOrder.unit"))}</th>
  <th class="amount">${escapeHtml(t("purchaseOrder.qty"))}</th>
  <th class="amount">${escapeHtml(t("purchaseOrder.unitPrice"))}</th>
  <th class="amount">${escapeHtml(t("purchaseOrder.taxRate"))}</th>
  <th class="amount">${escapeHtml(t("purchaseOrder.lineTotal"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="po-totals">
    <tr><th>${escapeHtml(t("purchaseOrder.totalNet"))}</th><td class="amount">${money(totalNet.toDecimalString(4))}</td></tr>
    <tr><th>${escapeHtml(t("purchaseOrder.totalTax"))}</th><td class="amount">${money(order.totalTax)}</td></tr>
    <tr class="grand-total"><th>${escapeHtml(t("purchaseOrder.grandTotal"))}</th><td class="amount">${money(order.totalAmount)}</td></tr>
  </table>
</div>
${order.notes ? `<p class="po-notes">${escapeHtml(order.notes)}</p>` : ""}`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("purchaseOrder.computerGenerated") }),
  });
}
