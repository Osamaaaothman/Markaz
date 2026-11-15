import { issuedFooter } from "../../documents/document-issued-footer.js";
import type { CashExpenseDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable cash expense voucher, in Arabic (RTL) or English (LTR) — the same shell and bilingual
// path as the payment voucher, but with no party and no settled invoices: just what was spent,
// out of which cash account, and on which expense accounts.
export async function cashExpenseToPdfHtml(params: {
  readonly expense: CashExpenseDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
  readonly sellerVatNumber?: string | null;
  readonly sellerCrNumber?: string | null;
  readonly sellerAddress?: string | null;
  readonly sellerPhone?: string | null;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { expense } = params;
  const cur = expense.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);

  const cashAccountName =
    params.language === "ar" && expense.cashAccountNameAr ? expense.cashAccountNameAr : expense.cashAccountName;

  // Seller identity shown under the company name in the shared header shell.
  const sellerDetailLines = [
    ...(params.sellerVatNumber?.trim() ? [`${t("seller.vatNumber")}: ${params.sellerVatNumber}`] : []),
    ...(params.sellerCrNumber?.trim() ? [`${t("seller.crNumber")}: ${params.sellerCrNumber}`] : []),
    ...(params.sellerAddress?.trim() ? [params.sellerAddress] : []),
    ...(params.sellerPhone?.trim() ? [`${t("seller.phone")}: ${params.sellerPhone}`] : []),
  ];

  const metaRows = [
    [t("cashExpense.number"), expense.number],
    [t("cashExpense.date"), expense.expenseDate],
    [t("cashExpense.bankAccount"), `${expense.cashAccountCode} — ${cashAccountName}`],
    ...(expense.reference ? [[t("cashExpense.reference"), expense.reference]] : []),
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const lineRows = expense.lines
    .map((line) => {
      const accountName = params.language === "ar" && line.expenseAccountNameAr ? line.expenseAccountNameAr : line.expenseAccountName;
      return `<tr><td>${escapeHtml(`${line.expenseAccountCode} — ${accountName}`)}</td><td>${escapeHtml(line.costCenterRef ?? "")}</td><td>${escapeHtml(line.description ?? "")}</td><td class="amount">${money(line.amount)}</td></tr>`;
    })
    .join("");

  const extraCss = `
  .cex-header { display: flex; justify-content: flex-end; margin-block-end: 12pt; }
  table.cex-meta { width: auto; border: none; }
  table.cex-meta th, table.cex-meta td { border: none; padding: 2pt 6pt; background: none; font-size: 9pt; white-space: nowrap; }
  table.cex-meta th { color: #666; font-weight: 400; }
  table.cex-meta td { font-weight: 600; text-align: end; }
  table.cex-lines { margin-block-start: 2pt; }
  table.cex-lines th { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-size: 9pt; }
  table.cex-lines td { font-size: 9pt; }
  table.cex-lines tbody tr:nth-child(even) td { background: #f9f9fb; }
  table.cex-lines tbody tr.total-row td { background: #1a1a1a; color: #fff; font-weight: 700; font-size: 10pt; }
  .amount-words { margin-block-start: 10pt; padding: 6pt 10pt; background: #f4f5fb; border-inline-start: 3pt solid #1a1a1a; font-size: 9.5pt; font-weight: 600; }
  .cex-notes { font-size: 8.5pt; color: #555; margin-block-start: 8pt; }
  `;

  return renderReportShell({
    language: params.language,
    documentTitle: `${t("cashExpense.title")} ${expense.number}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    sellerDetailLines,
    title: t("cashExpense.title"),
    subtitle: "",
    extraCss,
    bodyHtml: `
<div class="cex-header">
  <table class="cex-meta">${metaRows}</table>
</div>
<table class="cex-lines">
<thead><tr><th>${escapeHtml(t("cashExpense.expenseAccount"))}</th><th>${escapeHtml(t("cashExpense.costCenter"))}</th><th>${escapeHtml(t("cashExpense.description"))}</th><th class="amount">${escapeHtml(t("cashExpense.amount"))}</th></tr></thead>
<tbody>${lineRows}
<tr class="total-row"><td colspan="3">${escapeHtml(t("cashExpense.total"))}</td><td class="amount">${money(expense.amount)}</td></tr>
</tbody>
</table>
<p class="amount-words">${escapeHtml(t("cashExpense.inWords"))}: ${escapeHtml(tafqeetAmount(expense.amount, cur, params.language))}</p>
${expense.description ? `<p class="cex-notes">${escapeHtml(expense.description)}</p>` : ""}`,
    footerHtml: issuedFooter(
      { language: params.language, issuedBy: null, issuedAt: null },
      { issuedBy: t("document.issuedBy"), issuedAt: t("document.issuedAt"), notice: t("cashExpense.computerGenerated") },
    ),
  });
}
