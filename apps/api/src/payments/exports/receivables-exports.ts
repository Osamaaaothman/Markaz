import type { AgingReport, PartyStatement } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

const DENSE = "table { font-size: 8.5pt; } th, td { padding: 4pt 5pt; }";
const money = (amount: string, currency: string): string => `${Money.of(amount, currency).toDecimalString()} ${currency}`;
const partyName = (p: { partyName: string; partyNameAr: string | null }, lang: SupportedDocumentLanguage): string =>
  lang === "ar" && p.partyNameAr ? p.partyNameAr : p.partyName;

// ── Ageing ─────────────────────────────────────────────────────────────────────

export function agingToCsv(report: AgingReport, lang: SupportedDocumentLanguage): string {
  const rows: string[][] = [
    [report.side === "SALES" ? "Receivables ageing" : "Payables ageing", `As of ${report.asOf}`],
    ["Party", "Current", "1-30", "31-60", "61-90", "Over 90", "On account", "Total"],
  ];
  for (const p of report.parties) {
    rows.push([partyName(p, lang), p.current, p.days1to30, p.days31to60, p.days61to90, p.over90, p.onAccount, p.total]);
  }
  const t = report.totals;
  rows.push(["Total", t.current, t.days1to30, t.days31to60, t.days61to90, t.over90, t.onAccount, t.total]);
  if (report.ledgerBalance !== null) {
    rows.push(["Ledger balance", "", "", "", "", "", "", report.ledgerBalance]);
    rows.push(["Difference", "", "", "", "", "", "", report.difference ?? ""]);
  }
  return toCsvDocument(rows);
}

export async function agingToPdfHtml(params: {
  readonly report: AgingReport;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { report, currency } = params;
  const cell = (v: string): string => `<td class="amount">${escapeHtml(money(v, currency))}</td>`;
  const header = ["current", "days1to30", "days31to60", "days61to90", "over90", "onAccount", "total"]
    .map((k) => `<th class="amount">${escapeHtml(t(`aging.${k}`))}</th>`)
    .join("");
  const body = report.parties
    .map(
      (p) =>
        `<tr><td>${escapeHtml(partyName(p, params.language))}</td>${[p.current, p.days1to30, p.days31to60, p.days61to90, p.over90, p.onAccount, p.total].map(cell).join("")}</tr>`,
    )
    .join("");
  const tt = report.totals;
  const tie =
    report.ledgerBalance === null
      ? `<p class="subtitle">${escapeHtml(t("aging.notMapped"))}</p>`
      : `<p class="grand-total">${escapeHtml(t("aging.ledgerBalance"))}: ${escapeHtml(money(report.ledgerBalance, currency))} — ${escapeHtml(t("aging.difference"))}: ${escapeHtml(money(report.difference ?? "0", currency))}</p>`;

  return renderReportShell({
    language: params.language,
    documentTitle: t(report.side === "SALES" ? "aging.receivablesTitle" : "aging.payablesTitle"),
    companyName: params.companyName,
    title: t(report.side === "SALES" ? "aging.receivablesTitle" : "aging.payablesTitle"),
    subtitle: t("aging.subtitle", { asOf: report.asOf }),
    extraCss: DENSE,
    bodyHtml: `<table>
<thead><tr><th>${escapeHtml(t("aging.party"))}</th>${header}</tr></thead>
<tbody>
${body}
<tr class="total-row"><td>${escapeHtml(t("aging.total"))}</td>${[tt.current, tt.days1to30, tt.days31to60, tt.days61to90, tt.over90, tt.onAccount, tt.total].map(cell).join("")}</tr>
</tbody>
</table>${tie}`,
  });
}

// ── Party statement ────────────────────────────────────────────────────────────

export function statementToCsv(statement: PartyStatement, lang: SupportedDocumentLanguage): string {
  const rows: string[][] = [
    [statement.side === "SALES" ? "Customer statement" : "Supplier statement", partyName(statement, lang)],
    ["Period", `${statement.from} to ${statement.to}`],
    ["Date", "Type", "Number", "Reference", "Charges", "Payments and credits", "Balance"],
    ["", "", "", "Opening balance", "", "", statement.openingBalance],
  ];
  for (const l of statement.lines) rows.push([l.date, l.kind, l.number, l.reference ?? "", l.charge, l.settlement, l.balance]);
  rows.push(["", "", "", "Total", statement.totalCharges, statement.totalSettlements, statement.closingBalance]);
  return toCsvDocument(rows);
}

export async function statementToPdfHtml(params: {
  readonly statement: PartyStatement;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { statement, currency } = params;
  const cell = (v: string): string => `<td class="amount">${escapeHtml(money(v, currency))}</td>`;
  const rows = statement.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.date)}</td><td>${escapeHtml(t(`partyStatement.kinds.${l.kind}`))}</td><td>${escapeHtml(l.number)}</td><td>${escapeHtml(l.reference ?? "")}</td>${cell(l.charge)}${cell(l.settlement)}${cell(l.balance)}</tr>`,
    )
    .join("");
  const titleKey = statement.side === "SALES" ? "partyStatement.customerTitle" : "partyStatement.supplierTitle";
  return renderReportShell({
    language: params.language,
    documentTitle: t(titleKey),
    companyName: params.companyName,
    title: `${t(titleKey)} — ${partyName(statement, params.language)}`,
    subtitle: t("partyStatement.subtitle", { from: statement.from, to: statement.to }),
    extraCss: DENSE,
    bodyHtml: `<table>
<thead><tr><th>${escapeHtml(t("partyStatement.date"))}</th><th>${escapeHtml(t("partyStatement.type"))}</th><th>${escapeHtml(t("partyStatement.number"))}</th><th>${escapeHtml(t("partyStatement.reference"))}</th><th class="amount">${escapeHtml(t("partyStatement.charges"))}</th><th class="amount">${escapeHtml(t("partyStatement.settlements"))}</th><th class="amount">${escapeHtml(t("partyStatement.balance"))}</th></tr></thead>
<tbody>
<tr class="total-row"><td colspan="6">${escapeHtml(t("partyStatement.opening"))}</td>${cell(statement.openingBalance)}</tr>
${rows}
<tr class="total-row"><td colspan="4">${escapeHtml(t("partyStatement.total"))}</td>${cell(statement.totalCharges)}${cell(statement.totalSettlements)}${cell(statement.closingBalance)}</tr>
</tbody>
</table>`,
  });
}
