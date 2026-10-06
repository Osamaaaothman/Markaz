import type { SalesInvoiceDetail } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

// A printable invoice or credit note, in Arabic (RTL) or English (LTR). It shows the figures as posted.
// It is NOT a ZATCA e-invoice: no UUID, hash, QR or signature — those come from the compliance pack (M7).
export async function salesInvoiceToPdfHtml(params: {
  readonly invoice: SalesInvoiceDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { invoice } = params;
  const cur = invoice.currency;
  const money = (v: string): string => escapeHtml(`${Money.of(v, cur).toDecimalString()} ${cur}`);
  const customer = params.language === "ar" && invoice.customerNameAr ? invoice.customerNameAr : invoice.customerName;
  const title = t(invoice.documentType === "INVOICE" ? "salesInvoice.invoiceTitle" : "salesInvoice.creditNoteTitle");

  const rows = invoice.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.description)}</td><td class="amount">${escapeHtml(Number(l.quantity).toString())}</td><td class="amount">${money(l.unitPrice)}</td><td class="amount">${money(l.netAmount)}</td><td class="amount">${escapeHtml(Number(l.taxRate).toString())}%</td><td class="amount">${money(l.taxAmount)}</td></tr>`,
    )
    .join("");
  const meta = [
    [t("salesInvoice.number"), invoice.number],
    [t("salesInvoice.date"), invoice.invoiceDate],
    ...(invoice.dueDate ? [[t("salesInvoice.dueDate"), invoice.dueDate]] : []),
    [t("salesInvoice.customer"), customer],
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  return renderReportShell({
    language: params.language,
    documentTitle: `${title} ${invoice.number}`,
    companyName: params.companyName,
    title,
    subtitle: invoice.number,
    bodyHtml: `<table style="width:60%">${meta}</table>
<table>
<thead><tr><th>${escapeHtml(t("salesInvoice.description"))}</th><th class="amount">${escapeHtml(t("salesInvoice.quantity"))}</th><th class="amount">${escapeHtml(t("salesInvoice.unitPrice"))}</th><th class="amount">${escapeHtml(t("salesInvoice.net"))}</th><th class="amount">${escapeHtml(t("salesInvoice.taxRate"))}</th><th class="amount">${escapeHtml(t("salesInvoice.tax"))}</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<table style="width:45%;margin-inline-start:auto">
<tr><th>${escapeHtml(t("salesInvoice.net"))}</th><td class="amount">${money(invoice.totalNet)}</td></tr>
<tr><th>${escapeHtml(t("salesInvoice.tax"))}</th><td class="amount">${money(invoice.totalTax)}</td></tr>
<tr class="total-row"><th>${escapeHtml(t("salesInvoice.total"))}</th><td class="amount">${money(invoice.totalGross)}</td></tr>
</table>${invoice.notes ? `<p class="subtitle">${escapeHtml(invoice.notes)}</p>` : ""}`,
  });
}
