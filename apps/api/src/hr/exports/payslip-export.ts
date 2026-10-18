import type { PayrollRunLine } from "@erp/core";
import { Money } from "@erp/shared";
import { renderReportShell } from "../../accounting/exports/report-document.util.js";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

// One employee's payslip for one payroll run, in Arabic (RTL) or English (LTR). Figures as
// posted -- not a ZATCA e-invoice, no compliance fields; this is an internal HR document.
export async function payslipToPdfHtml(params: {
  readonly runNumber: string;
  readonly periodYear: number;
  readonly periodMonth: number; // 1-12
  readonly runDate: string;
  readonly currency: string;
  readonly line: PayrollRunLine;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
}): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const { line, currency } = params;
  const money = (v: string): string => escapeHtml(`${Money.of(v, currency).toDecimalString()} ${currency}`);
  const employeeName = params.language === "ar" && line.employeeNameAr ? line.employeeNameAr : line.employeeName;
  const period = `${t(`payslip.months.${MONTH_KEYS[params.periodMonth - 1]}`)} ${params.periodYear}`;
  const title = t("payslip.title");

  const meta = [
    [t("payslip.employee"), employeeName],
    [t("payslip.employeeRef"), line.employeeRef],
    [t("payslip.period"), period],
    [t("payslip.runNumber"), params.runNumber],
    [t("payslip.runDate"), params.runDate],
  ]
    .map(([k, v]) => `<tr><th>${escapeHtml(k ?? "")}</th><td>${escapeHtml(v ?? "")}</td></tr>`)
    .join("");

  const earnings = [
    [t("payslip.basicSalary"), line.basicSalary],
    [t("payslip.housingAllowance"), line.housingAllowance],
    [t("payslip.otherAllowances"), line.otherAllowances],
  ]
    .map(([k, v]) => `<tr><td>${escapeHtml(k ?? "")}</td><td class="amount">${money(v ?? "0")}</td></tr>`)
    .join("");

  const deductions = [
    [t("payslip.gosiEmployee"), line.gosiEmployeeShare],
    [t("payslip.advanceDeduction"), line.advanceDeduction],
  ]
    .map(([k, v]) => `<tr><td>${escapeHtml(k ?? "")}</td><td class="amount">${money(v ?? "0")}</td></tr>`)
    .join("");

  return renderReportShell({
    language: params.language,
    documentTitle: `${title} — ${employeeName} — ${period}`,
    companyName: params.companyName,
    ...(params.logoDataUri ? { logoDataUri: params.logoDataUri } : {}),
    title,
    subtitle: period,
    bodyHtml: `<table style="width:60%">${meta}</table>
<div style="display:flex;gap:16pt;margin-block-start:10pt">
  <table style="width:50%">
    <thead><tr><th colspan="2">${escapeHtml(t("payslip.earnings"))}</th></tr></thead>
    <tbody>${earnings}
    <tr class="total-row"><th>${escapeHtml(t("payslip.gross"))}</th><td class="amount">${money(line.gross)}</td></tr>
    </tbody>
  </table>
  <table style="width:50%">
    <thead><tr><th colspan="2">${escapeHtml(t("payslip.deductions"))}</th></tr></thead>
    <tbody>${deductions}</tbody>
  </table>
</div>
<table style="width:45%;margin-inline-start:auto;margin-block-start:10pt">
<tr class="total-row"><th>${escapeHtml(t("payslip.net"))}</th><td class="amount">${money(line.net)}</td></tr>
</table>`,
  });
}
