import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { GoodsReturnDetail } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function goodsReturnToPdfHtml(params: {
  readonly gr: GoodsReturnDetail;
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
  const { gr } = params;
  const cur = gr.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const supplier = params.language === "ar" && gr.supplierNameAr ? gr.supplierNameAr : gr.supplierName;
  const warehouse = params.language === "ar" && gr.warehouseNameAr ? gr.warehouseNameAr : gr.warehouseName;

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("goodsReturn.number"), gr.number],
    [t("goodsReturn.date"), gr.documentDate],
    [t("goodsReturn.supplier"), supplier],
    [t("goodsReturn.warehouse"), warehouse],
    [t("goodsReturn.purchaseOrder"), gr.purchaseOrderNumber],
    ...(gr.reason ? [[t("goodsReturn.reason"), gr.reason]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = gr.lines
    .map((l) => {
      const item = params.language === "ar" && l.itemNameAr ? l.itemNameAr : l.itemName;
      return `<tr>
        <td>${escapeHtml(l.itemCode)}</td>
        <td>${escapeHtml(item)}</td>
        <td>—</td>
        <td class="amount">${escapeHtml(Number(l.quantity).toString())}</td>
        <td class="amount">${money(l.unitCost)}</td>
        <td class="amount">${money(l.value)}</td>
      </tr>`;
    })
    .join("");

  const extraCss = `
  .gr-meta { display: flex; justify-content: right; margin-block-end: 14pt; }
  table.gr-meta-table { width: auto; border: none; }
  table.gr-meta-table th, table.gr-meta-table td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.gr-meta-table th { color: #666; font-weight: 400; }
  table.gr-meta-table td { font-weight: 600; text-align: end; }
  table.gr-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.gr-lines td { font-size: 9pt; }
  table.gr-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: right; margin-block-start: 8pt; }
  table.gr-total { width: 42%; border: none; }
  table.gr-total tr td, table.gr-total tr th { border: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("goodsReturn.title")} ${gr.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("goodsReturn.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="gr-meta"><table class="gr-meta-table">${metaRows}</table></div>
<table class="gr-lines">
<thead><tr>
  <th>${escapeHtml(t("goodsReturn.code"))}</th>
  <th>${escapeHtml(t("goodsReturn.item"))}</th>
  <th>${escapeHtml(t("goodsReturn.unit"))}</th>
  <th class="amount">${escapeHtml(t("goodsReturn.qty"))}</th>
  <th class="amount">${escapeHtml(t("goodsReturn.value"))}</th>
  <th class="amount">${escapeHtml(t("goodsReturn.total"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="gr-total">
    <tr><th>${escapeHtml(t("goodsReturn.total"))}</th><td class="amount">${money(gr.totalValue)}</td></tr>
  </table>
</div>
`,
    footerHtml: issuedFooter(params, { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("goodsReturn.computerGenerated") }),
  });
}
