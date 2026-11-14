import type { QuotationDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";
import { renderEmailShell } from "../../notifications/email-shell.js";

export interface QuotationEmailContent { readonly subject: string; readonly html: string; readonly text: string }

export async function quotationEmailContent(params: {
  readonly quotation: QuotationDetail;
  readonly language: SupportedDocumentLanguage;
  readonly companyName: string;
  readonly logoDataUri?: string | undefined;
  readonly sellerPhone?: string | null;
  readonly sellerAddress?: string | null;
}): Promise<QuotationEmailContent> {
  const t = await getDocumentTranslator(params.language);
  const { quotation } = params;
  const cur = quotation.currency;
  const align = params.language === "ar" ? "right" : "left";
  const end = align === "right" ? "left" : "right";
  const money = (value: string): string => `${Money.of(value, cur).toDecimalString().replace(/\B(?=(\d{3})+\.)/g, ",")} ${cur}`;
  const customer = params.language === "ar" && quotation.customerNameAr ? quotation.customerNameAr : quotation.customerName;
  const subject = t("quotation.email.subject", { number: quotation.number, company: params.companyName });
  const validUntil = quotation.validUntil ? new Intl.DateTimeFormat(params.language === "ar" ? "ar-SA" : "en-GB", {
    calendar: "gregory", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(quotation.validUntil)) : null;
  const intro = validUntil ? t("quotation.email.intro", { number: quotation.number, validUntil, company: params.companyName })
    : t("quotation.email.introNoExpiry", { number: quotation.number, company: params.companyName });
  const words = tafqeetAmount(quotation.totalGross, cur, params.language);
  const meta = [[t("quotation.number"), quotation.number], [t("quotation.date"), quotation.quotationDate], ...(validUntil ? [[t("quotation.validUntil"), validUntil]] : [])];
  const rows = quotation.lines.map((line) => `<tr><td style="padding:12px 8px;border-bottom:1px solid #e5eae7;overflow-wrap:anywhere;">${escapeHtml(line.description)}</td><td align="center" style="padding:12px 4px;border-bottom:1px solid #e5eae7;">${escapeHtml(Number(line.quantity).toString())}</td><td align="${end}" style="padding:12px 8px;border-bottom:1px solid #e5eae7;"><span dir="ltr" style="white-space:nowrap;">${escapeHtml(money(line.netAmount))}</span></td></tr>`).join("");
  const html = renderEmailShell({
    ...params, subject, label: t("quotation.title"), preview: `${quotation.number} · ${money(quotation.totalGross)}`,
    bodyHtml: `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.5;font-weight:700;">${escapeHtml(t("quotation.email.greeting", { customer }))}</h1>
<p style="margin:0 0 24px;font-size:14px;color:#52645b;">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;background:#f5f7f5;border:1px solid #e5eae7;margin-bottom:24px;">${meta.map(([label, value]) => `<tr><td style="padding:9px 12px;color:#65746c;" align="${align}">${escapeHtml(label ?? "")}</td><td style="padding:9px 12px;font-weight:600;" align="${end}">${escapeHtml(value ?? "")}</td></tr>`).join("")}</table>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;line-height:1.65;margin-bottom:18px;">
<thead><tr><th align="${align}" style="padding:10px 8px;border-bottom:2px solid #244f43;">${escapeHtml(t("quotation.description"))}</th><th width="48" style="padding:10px 4px;border-bottom:2px solid #244f43;">${escapeHtml(t("quotation.quantity"))}</th><th align="${end}" style="padding:10px 8px;border-bottom:2px solid #244f43;">${escapeHtml(t("quotation.net"))}</th></tr></thead><tbody>${rows}</tbody></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="padding:5px 8px;color:#65746c;">${escapeHtml(t("quotation.net"))}</td><td align="${end}" dir="ltr" style="padding:5px 8px;">${escapeHtml(money(quotation.totalNet))}</td></tr>
<tr><td style="padding:5px 8px 14px;color:#65746c;">${escapeHtml(t("quotation.tax"))}</td><td align="${end}" dir="ltr" style="padding:5px 8px 14px;">${escapeHtml(money(quotation.totalTax))}</td></tr>
<tr><td style="padding:15px 12px;background:#edf3ef;color:#244f43;font-weight:700;">${escapeHtml(t("quotation.email.totalLabel"))}</td><td align="${end}" dir="ltr" style="padding:15px 12px;background:#edf3ef;color:#244f43;font-size:21px;font-weight:700;">${escapeHtml(money(quotation.totalGross))}</td></tr></table>
<p style="margin:10px 2px 24px;font-size:12px;color:#65746c;">${escapeHtml(words)}</p>
<p style="margin:0 0 12px;padding:12px;border:1px solid #dce3df;font-size:13px;">${escapeHtml(t("quotation.email.viewAttached"))}</p>
<p style="font-size:13px;color:#52645b;margin:20px 0;">${escapeHtml(t("quotation.email.closing"))}</p>
<p style="font-size:13px;margin:0;">${escapeHtml(t("quotation.email.regards"))}<br/>${escapeHtml(t("quotation.email.salesTeam"))}<br/><strong>${escapeHtml(params.companyName)}</strong></p>`,
    footerHtml: [params.companyName, params.sellerPhone, params.sellerAddress].filter(Boolean).map((value) => escapeHtml(value!)).join("<br/>"),
  });
  const text = [t("quotation.email.greeting", { customer }), intro,
    meta.map(([label, value]) => `${label}: ${value}`).join("\n"),
    quotation.lines.map((line) => `${line.description} · ${line.quantity} · ${money(line.netAmount)}`).join("\n"),
    [`${t("quotation.net")}: ${money(quotation.totalNet)}`, `${t("quotation.tax")}: ${money(quotation.totalTax)}`, `${t("quotation.email.totalLabel")}: ${money(quotation.totalGross)}`, words].join("\n"),
    t("quotation.email.viewAttached"), t("quotation.email.closing"),
    [t("quotation.email.regards"), t("quotation.email.salesTeam"), params.companyName, params.sellerPhone, params.sellerAddress].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n");
  return { subject, html, text };
}
