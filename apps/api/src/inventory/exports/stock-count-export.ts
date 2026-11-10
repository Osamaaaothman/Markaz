import type { StockCountDetail } from "@erp/core";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function stockCountToPdfHtml(params: {
  readonly count: StockCountDetail;
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
  const { count } = params;
  const warehouse = params.language === "ar" && count.warehouseNameAr ? count.warehouseNameAr : count.warehouseName;

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const statusLabel = count.isPosted ? t("stockCount.posted") : t("stockCount.draft");

  const metaRows = [
    [t("stockCount.number"), count.number],
    [t("stockCount.date"), count.documentDate],
    [t("stockCount.warehouse"), warehouse],
    [t("stockCount.status"), statusLabel],
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = count.lines
    .map((l) => {
      const item = params.language === "ar" && l.itemNameAr ? l.itemNameAr : l.itemName;
      const diff = Number(l.difference);
      const diffColor = diff > 0 ? "#15803d" : diff < 0 ? "#b91c1c" : "inherit";
      return `<tr>
        <td>${escapeHtml(l.itemCode)}</td>
        <td>${escapeHtml(item)}</td>
        <td>${escapeHtml(l.unit)}</td>
        <td class="amount">${escapeHtml(Number(l.systemQuantity).toString())}</td>
        <td class="amount">${escapeHtml(Number(l.countedQuantity).toString())}</td>
        <td class="amount" style="color:${diffColor};font-weight:600">${diff > 0 ? "+" : ""}${escapeHtml(Number(l.difference).toString())}</td>
        <td class="amount">${escapeHtml(Number(l.unitCost).toString())}</td>
      </tr>`;
    })
    .join("");

  const extraCss = `
  .cnt-meta { display: flex; justify-content: flex-end; margin-block-end: 14pt; }
  table.cnt-meta-table { width: auto; border: none; }
  table.cnt-meta-table th, table.cnt-meta-table td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.cnt-meta-table th { color: #666; font-weight: 400; }
  table.cnt-meta-table td { font-weight: 600; text-align: end; }
  table.cnt-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.cnt-lines td { font-size: 9pt; }
  table.cnt-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .cnt-issued-by { margin-block-start: 16pt; padding: 6pt 10pt; border: 1px solid #e8e8e8; border-radius: 4pt; font-size: 8pt; color: #555; display: flex; gap: 24pt; }
  .cnt-issued-by strong { font-size: 7.5pt; color: #aaa; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-block-end: 2pt; }
  .cnt-footer { margin-block-start: 24pt; padding-block-start: 6pt; border-block-start: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("stockCount.title")} ${count.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("stockCount.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="cnt-meta"><table class="cnt-meta-table">${metaRows}</table></div>
<table class="cnt-lines">
<thead><tr>
  <th>${escapeHtml(t("stockCount.item"))}</th>
  <th>${escapeHtml(t("stockCount.item"))}</th>
  <th>${escapeHtml(t("stockCount.unit"))}</th>
  <th class="amount">${escapeHtml(t("stockCount.systemQty"))}</th>
  <th class="amount">${escapeHtml(t("stockCount.countedQty"))}</th>
  <th class="amount">${escapeHtml(t("stockCount.difference"))}</th>
  <th class="amount">${escapeHtml(t("stockCount.unitCost"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
${params.issuedBy || params.issuedAt ? `<div class="cnt-issued-by">${params.issuedBy ? `<span><strong>${escapeHtml(t("document.issuedBy"))}</strong>${escapeHtml(params.issuedBy)}</span>` : ""}${params.issuedAt ? `<span><strong>${escapeHtml(t("document.issuedAt"))}</strong>${escapeHtml(params.issuedAt)}</span>` : ""}</div>` : ""}
<div class="cnt-footer">${escapeHtml(t("stockCount.computerGenerated"))}</div>`,
  });
}
