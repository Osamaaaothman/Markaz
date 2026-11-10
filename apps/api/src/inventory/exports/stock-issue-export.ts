import type { StockIssueDetail } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export async function stockIssueToPdfHtml(params: {
  readonly issue: StockIssueDetail;
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
  const { issue } = params;
  const cur = issue.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const warehouse = params.language === "ar" && issue.warehouseNameAr ? issue.warehouseNameAr : issue.warehouseName;

  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("stockIssue.number"), issue.number],
    [t("stockIssue.date"), issue.documentDate],
    [t("stockIssue.warehouse"), warehouse],
    [t("stockIssue.costCenter"), issue.costCenterRef],
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = issue.lines
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
  .iss-meta { display: flex; justify-content: flex-end; margin-block-end: 14pt; }
  table.iss-meta-table { width: auto; border: none; }
  table.iss-meta-table th, table.iss-meta-table td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.iss-meta-table th { color: #666; font-weight: 400; }
  table.iss-meta-table td { font-weight: 600; text-align: end; }
  table.iss-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.iss-lines td { font-size: 9pt; }
  table.iss-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-block-start: 8pt; }
  table.iss-total { width: 42%; border: none; }
  table.iss-total tr td, table.iss-total tr th { border: none; background: #1a1a1a; color: #fff; font-size: 11pt; font-weight: 700; padding: 6pt 8pt; }
  .iss-issued-by { margin-block-start: 16pt; padding: 6pt 10pt; border: 1px solid #e8e8e8; border-radius: 4pt; font-size: 8pt; color: #555; display: flex; gap: 24pt; }
  .iss-issued-by strong { font-size: 7.5pt; color: #aaa; font-weight: 400; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-block-end: 2pt; }
  .iss-footer { margin-block-start: 24pt; padding-block-start: 6pt; border-block-start: 1px solid #ddd; font-size: 7.5pt; color: #aaa; text-align: center; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("stockIssue.title")} ${issue.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("stockIssue.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="iss-meta"><table class="iss-meta-table">${metaRows}</table></div>
<table class="iss-lines">
<thead><tr>
  <th>${escapeHtml(t("stockIssue.item"))}</th>
  <th>${escapeHtml(t("stockIssue.item"))}</th>
  <th>${escapeHtml(t("stockIssue.unit"))}</th>
  <th class="amount">${escapeHtml(t("stockIssue.qty"))}</th>
  <th class="amount">${escapeHtml(t("stockIssue.unitCost"))}</th>
  <th class="amount">${escapeHtml(t("stockIssue.value"))}</th>
</tr></thead>
<tbody>${lineRows}</tbody>
</table>
<div class="totals-wrap">
  <table class="iss-total">
    <tr><th>${escapeHtml(t("stockIssue.total"))}</th><td class="amount">${money(issue.totalValue)}</td></tr>
  </table>
</div>
${params.issuedBy || params.issuedAt ? `<div class="iss-issued-by">${params.issuedBy ? `<span><strong>${escapeHtml(t("document.issuedBy"))}</strong>${escapeHtml(params.issuedBy)}</span>` : ""}${params.issuedAt ? `<span><strong>${escapeHtml(t("document.issuedAt"))}</strong>${escapeHtml(params.issuedAt)}</span>` : ""}</div>` : ""}
<div class="iss-footer">${escapeHtml(t("stockIssue.computerGenerated"))}</div>`,
  });
}
