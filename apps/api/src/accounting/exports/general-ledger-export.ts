import type { LedgerStatement } from "@erp/core";
import { toCsvDocument } from "../../common/csv.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { formatAmount, renderReportShell } from "./report-document.util.js";

export function generalLedgerToCsv(statement: LedgerStatement): string {
  const rows: string[][] = [
    ["Account", `${statement.accountCode} ${statement.accountName}`],
    ["Period", `${statement.from} to ${statement.to}`],
    ["Date", "Entry", "Description", "Debit", "Credit", "Balance"],
    ["", "", "Opening balance", "", "", statement.openingBalance],
  ];
  for (const line of statement.lines) {
    rows.push([line.entryDate, line.entryNumber, line.description ?? "", line.debit, line.credit, line.balance]);
  }
  rows.push(["", "", "Total", statement.totalDebit, statement.totalCredit, statement.closingBalance]);
  return toCsvDocument(rows);
}

export async function generalLedgerToPdfHtml(params: {
  readonly statement: LedgerStatement;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly currency: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { statement, currency } = params;
  const money = (amount: string): string => escapeHtml(formatAmount(amount, currency));

  const bodyRows = statement.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.entryDate)}</td><td>${escapeHtml(line.entryNumber)}</td>` +
        `<td>${escapeHtml(line.description ?? "")}</td>` +
        `<td class="amount">${money(line.debit)}</td><td class="amount">${money(line.credit)}</td>` +
        `<td class="amount">${money(line.balance)}</td></tr>`,
    )
    .join("");

  const truncatedNote = statement.truncated ? `<p class="subtitle">${escapeHtml(t("generalLedger.truncated"))}</p>` : "";
  const bodyHtml = `<table>
<thead><tr><th>${escapeHtml(t("generalLedger.date"))}</th><th>${escapeHtml(t("generalLedger.entry"))}</th><th>${escapeHtml(t("generalLedger.description"))}</th><th class="amount">${escapeHtml(t("generalLedger.debit"))}</th><th class="amount">${escapeHtml(t("generalLedger.credit"))}</th><th class="amount">${escapeHtml(t("generalLedger.balance"))}</th></tr></thead>
<tbody>
<tr class="total-row"><td colspan="5">${escapeHtml(t("generalLedger.openingBalance"))}</td><td class="amount">${money(statement.openingBalance)}</td></tr>
${bodyRows}
<tr class="total-row"><td colspan="3">${escapeHtml(t("generalLedger.total"))}</td><td class="amount">${money(statement.totalDebit)}</td><td class="amount">${money(statement.totalCredit)}</td><td class="amount">${money(statement.closingBalance)}</td></tr>
</tbody>
</table>${truncatedNote}`;

  return renderReportShell({
    language: params.language,
    documentTitle: t("generalLedger.title"),
    companyName: params.companyName,
    title: `${t("generalLedger.title")} — ${statement.accountCode} ${statement.accountName}`,
    subtitle: t("generalLedger.subtitle", { from: statement.from, to: statement.to }),
    bodyHtml,
  });
}
