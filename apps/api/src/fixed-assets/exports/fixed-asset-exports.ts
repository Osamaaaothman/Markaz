import type { MovementReport, RegisterReport } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell } from "../../accounting/exports/report-document.util.js";

const pick = (lang: SupportedDocumentLanguage, en: string, ar: string | null): string => (lang === "ar" && ar ? ar : en);

export function registerToCsv(report: RegisterReport, lang: SupportedDocumentLanguage): string {
  const rows: string[][] = [["Number", "Asset", "Category", "In service", "Life (months)", "Cost", "Accumulated depreciation", "Net book value", "Location", "Custodian"]];
  for (const r of report.rows) {
    rows.push([r.number, pick(lang, r.name, r.nameAr), pick(lang, r.categoryName, r.categoryNameAr), r.inServiceDate, r.usefulLifeMonths?.toString() ?? "", r.cost, r.accumulatedDepreciation, r.netBookValue, r.location ?? "", r.custodianName ?? ""]);
  }
  rows.push(["", "Total", "", "", "", report.totals.cost, report.totals.accumulatedDepreciation, report.totals.netBookValue, "", ""]);
  return toCsvDocument(rows);
}

export async function registerToPdfHtml(params: { readonly report: RegisterReport; readonly language: SupportedDocumentLanguage; readonly companyName: string }): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { report, language } = params;
  const amount = (v: string): string => `<td class="amount">${escapeHtml(formatAmount(v, report.currency))}</td>`;
  const body = report.rows
    .map((r) => `<tr><td>${escapeHtml(r.number)}</td><td>${escapeHtml(pick(language, r.name, r.nameAr))}</td><td>${escapeHtml(pick(language, r.categoryName, r.categoryNameAr))}</td><td>${escapeHtml(r.inServiceDate)}</td>${amount(r.cost)}${amount(r.accumulatedDepreciation)}${amount(r.netBookValue)}</tr>`)
    .join("");
  const bodyHtml = `<table class="fa">
<thead><tr>${["number", "asset", "category", "inService", "cost", "accumulated", "netBookValue"].map((k) => `<th${["cost", "accumulated", "netBookValue"].includes(k) ? ' class="amount"' : ""}>${escapeHtml(t(`fixedAssets.${k}`))}</th>`).join("")}</tr></thead>
<tbody>${body}
<tr class="total-row"><td colspan="4">${escapeHtml(t("fixedAssets.total"))}</td>${amount(report.totals.cost)}${amount(report.totals.accumulatedDepreciation)}${amount(report.totals.netBookValue)}</tr>
</tbody></table>`;
  return renderReportShell({
    language,
    documentTitle: t("fixedAssets.registerTitle"),
    companyName: params.companyName,
    title: t("fixedAssets.registerTitle"),
    subtitle: t("fixedAssets.asOf", { date: report.asOf }),
    bodyHtml,
    extraCss: "@page { size: A4 landscape; margin: 12mm; } .fa { font-size: 8.5pt; } .fa td, .fa th { padding: 3pt 5pt; }",
  });
}

const MOVEMENT_COLUMNS = ["costOpening", "costAdditions", "costDisposals", "costClosing", "depreciationOpening", "depreciationOnOpeningAssets", "depreciationCharge", "depreciationOnDisposals", "depreciationClosing", "netBookValueClosing"] as const;

export function movementToCsv(report: MovementReport, lang: SupportedDocumentLanguage): string {
  const rows: string[][] = [["Category", ...MOVEMENT_COLUMNS]];
  for (const r of report.rows) rows.push([pick(lang, r.categoryName, r.categoryNameAr), ...MOVEMENT_COLUMNS.map((k) => r[k])]);
  rows.push(["Total", ...MOVEMENT_COLUMNS.map((k) => report.totals[k])]);
  return toCsvDocument(rows);
}

export async function movementToPdfHtml(params: { readonly report: MovementReport; readonly language: SupportedDocumentLanguage; readonly companyName: string }): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { report, language } = params;
  const amount = (v: string): string => `<td class="amount">${escapeHtml(formatAmount(v, report.currency))}</td>`;
  const body = report.rows.map((r) => `<tr><td>${escapeHtml(pick(language, r.categoryName, r.categoryNameAr))}</td>${MOVEMENT_COLUMNS.map((k) => amount(r[k])).join("")}</tr>`).join("");
  const bodyHtml = `<table class="fa">
<thead><tr><th>${escapeHtml(t("fixedAssets.category"))}</th>${MOVEMENT_COLUMNS.map((k) => `<th class="amount">${escapeHtml(t(`fixedAssets.movement.${k}`))}</th>`).join("")}</tr></thead>
<tbody>${body}
<tr class="total-row"><td>${escapeHtml(t("fixedAssets.total"))}</td>${MOVEMENT_COLUMNS.map((k) => amount(report.totals[k])).join("")}</tr>
</tbody></table>`;
  return renderReportShell({
    language,
    documentTitle: t("fixedAssets.movementTitle"),
    companyName: params.companyName,
    title: t("fixedAssets.movementTitle"),
    subtitle: t("fixedAssets.period", { from: report.from, to: report.to }),
    bodyHtml,
    extraCss: "@page { size: A4 landscape; margin: 10mm; } .fa { font-size: 7.5pt; } .fa td, .fa th { padding: 2pt 4pt; }",
  });
}
