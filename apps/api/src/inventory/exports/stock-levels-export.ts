import type { StockLevelEntry } from "@erp/core";
import { Money } from "@erp/shared";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell } from "../../accounting/exports/report-document.util.js";

// Sum of stock values as exact decimal text. Money.of is the repo's decimal wrapper (docs/04 §2).
export function totalStockValue(entries: readonly StockLevelEntry[], currency: string): string {
  return entries
    .reduce((sum, entry) => sum.add(Money.of(entry.value, currency)), Money.zero(currency))
    .toDecimalString(4);
}

export function stockLevelsToCsv(entries: readonly StockLevelEntry[], currency: string): string {
  const rows: string[][] = [["Item Ref", "Item Code", "Item", "Warehouse", "Quantity", "Average Cost", "Value", "Reorder Point"]];
  for (const e of entries) {
    rows.push([e.itemRef, e.itemCode, e.itemName, e.warehouseName, e.quantity, e.averageUnitCost, e.value, e.reorderPoint]);
  }
  rows.push(["", "", "", "Total", "", "", totalStockValue(entries, currency), ""]);
  return toCsvDocument(rows);
}

export async function stockLevelsToPdfHtml(params: {
  readonly entries: readonly StockLevelEntry[];
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const asOf = new Date().toISOString().slice(0, 10);
  const itemName = (e: StockLevelEntry): string => (params.language === "ar" && e.itemNameAr ? e.itemNameAr : e.itemName);

  const bodyRows = params.entries
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.itemCode)}</td><td>${escapeHtml(itemName(e))}</td><td>${escapeHtml(e.warehouseName)}</td>` +
        `<td class="amount">${escapeHtml(e.quantity)}</td>` +
        `<td class="amount">${escapeHtml(`${Money.of(e.averageUnitCost, params.currency).toDecimalString(4)} ${params.currency}`)}</td>` +
        `<td class="amount">${escapeHtml(formatAmount(e.value, params.currency))}</td></tr>`,
    )
    .join("");

  const bodyHtml = `<table>
<thead><tr><th>${escapeHtml(t("stockLevels.code"))}</th><th>${escapeHtml(t("stockLevels.item"))}</th><th>${escapeHtml(t("stockLevels.warehouse"))}</th><th class="amount">${escapeHtml(t("stockLevels.quantity"))}</th><th class="amount">${escapeHtml(t("stockLevels.averageCost"))}</th><th class="amount">${escapeHtml(t("stockLevels.value"))}</th></tr></thead>
<tbody>
${bodyRows}
<tr class="total-row"><td colspan="5">${escapeHtml(t("stockLevels.totalValue"))}</td><td class="amount">${escapeHtml(formatAmount(totalStockValue(params.entries, params.currency), params.currency))}</td></tr>
</tbody>
</table>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("stockLevels.title"),
    companyName: params.companyName,
    title: t("stockLevels.title"),
    subtitle: t("stockLevels.subtitle", { asOf }),
    bodyHtml,
  });
}
