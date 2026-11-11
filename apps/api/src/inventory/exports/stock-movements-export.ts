import type { StockMovementEntry } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export function stockMovementsToCsv(entries: readonly StockMovementEntry[]): string {
  const rows: string[][] = [["Date", "Item Code", "Item", "Warehouse", "Type", "Quantity", "Unit Cost", "Value", "Source", "Entry", "Customer / Supplier", "Customer / Supplier (Arabic)"]];
  for (const e of entries) {
    rows.push([e.date.slice(0, 10), e.itemCode, e.itemName, e.warehouseName, e.movementType, e.quantity, e.unitCost, e.value, e.sourceDocumentType, e.entryNumber, e.partyName ?? "", e.partyNameAr ?? ""]);
  }
  return toCsvDocument(rows);
}

export async function stockMovementsToPdfHtml(params: {
  readonly entries: readonly StockMovementEntry[];
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const name = (en: string, ar: string | null): string => escapeHtml(params.language === "ar" && ar ? ar : en);
  const headings = ["date", "item", "warehouse", "type", "party", "quantity", "unitCost", "value", "source"];
  const rows = params.entries.map((e) => `<tr>
    <td><bdi>${escapeHtml(e.date.slice(0, 10))}</bdi></td>
    <td><bdi class="code">${escapeHtml(e.itemCode)}</bdi><br>${name(e.itemName, e.itemNameAr)}</td>
    <td>${name(e.warehouseName, e.warehouseNameAr)}</td>
    <td>${escapeHtml(t(`stockMovements.types.${e.movementType}`))}</td>
    <td>${e.partyName ? name(e.partyName, e.partyNameAr) : "—"}</td>
    <td class="amount"><bdi>${escapeHtml(e.quantity)}</bdi></td>
    <td class="amount"><bdi>${escapeHtml(e.unitCost)}</bdi></td>
    <td class="amount"><bdi>${escapeHtml(e.value)}</bdi></td>
    <td>${escapeHtml(t(`stockMovements.sources.${e.sourceDocumentType}`, { defaultValue: e.sourceDocumentType }))}<br><bdi class="code">${escapeHtml(e.entryNumber)}</bdi></td>
  </tr>`).join("");
  return renderReportShell({ language: params.language, companyName: params.companyName,
    documentTitle: t("stockMovements.title"), title: t("stockMovements.title"),
    subtitle: t("stockMovements.summary", { count: params.entries.length, currency: `\u2066${params.currency}\u2069` }) +
      (params.from || params.to ? ` · \u2066${params.from ?? "…"} — ${params.to ?? "…"}\u2069` : ""),
    bodyHtml: `<table><colgroup><col style="width:9%"><col style="width:18%"><col style="width:11%"><col style="width:9%"><col style="width:13%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:14%"></colgroup><thead><tr>${headings.map((h) => `<th>${escapeHtml(t(`stockMovements.${h}`))}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="9">${escapeHtml(t("stockMovements.empty"))}</td></tr>`}</tbody></table>`,
    extraCss: "@page { size: A4 landscape; margin: 12mm; } table { table-layout: fixed; } th,td { font-size: 8pt; padding: 6pt; overflow-wrap: anywhere; line-height: 1.6; } thead { display: table-header-group; } tr { break-inside: avoid; } tbody tr:nth-child(even) { background: #f8fafc; } th { background: #eef2f6; } .code { font-size: 7.5pt; color: #475569; } bdi { unicode-bidi: isolate; } td.amount { text-align: right; }",
  });
}
