import type { QuotationDetail } from "@erp/core";
import { Money, tafqeetAmount } from "@erp/shared";
import { escapeHtml } from "../../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../../i18n/server-i18n.js";

export interface QuotationEmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

// Email HTML needs its own rules, not the PDF's: no flexbox/grid (most clients strip them),
// every visual rule inlined on the element itself (many clients strip <style> blocks), and a
// <table> skeleton for layout because that is the one thing every client renders consistently.
// A plain-text sibling is built alongside it — some clients show it in a notification/preview,
// and a handful of spam filters penalize an HTML-only message.
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
  const dir = params.language === "ar" ? "rtl" : "ltr";
  const align = params.language === "ar" ? "right" : "left";
  const money = (v: string): string => `${Money.of(v, cur).toDecimalString()} ${cur}`;
  const customer = params.language === "ar" && quotation.customerNameAr ? quotation.customerNameAr : quotation.customerName;

  const subject = t("quotation.email.subject", { number: quotation.number, company: params.companyName });
  const intro = quotation.validUntil
    ? t("quotation.email.intro", { number: quotation.number, validUntil: quotation.validUntil })
    : t("quotation.email.introNoExpiry", { number: quotation.number });

  const palette = {
    ink: "#131b2e",
    gold: "#b9975b",
    goldLight: "#f4ecdd",
    paper: "#f7f5f1",
    line: "#e7e2d8",
    muted: "#6b7280",
  };

  const lineRows = quotation.lines
    .map(
      (l, i) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid ${palette.line};font-size:13px;color:${palette.ink};font-family:Arial,'Segoe UI',sans-serif;${i % 2 === 1 ? `background:${palette.paper};` : ""}">${escapeHtml(l.description)}</td>
      <td align="center" style="padding:12px 16px;border-bottom:1px solid ${palette.line};font-size:13px;color:${palette.ink};font-family:Arial,'Segoe UI',sans-serif;${i % 2 === 1 ? `background:${palette.paper};` : ""}">${escapeHtml(Number(l.quantity).toString())}</td>
      <td align="end" style="padding:12px 16px;border-bottom:1px solid ${palette.line};font-size:13px;color:${palette.ink};font-family:Arial,'Segoe UI',sans-serif;white-space:nowrap;${i % 2 === 1 ? `background:${palette.paper};` : ""}">${escapeHtml(money(l.netAmount))}</td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${params.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ece7dd;font-family:Arial,'Segoe UI',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece7dd;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 24px rgba(19,27,46,0.12);">

  <tr><td style="background:${palette.ink};padding:28px 36px;" align="${align}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">
        ${params.logoDataUri ? `<img src="${escapeHtml(params.logoDataUri)}" alt="${escapeHtml(params.companyName)}" height="40" style="height:40px;max-width:160px;object-fit:contain;display:block;" />` : `<span style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(params.companyName)}</span>`}
      </td>
      <td style="vertical-align:middle;text-align:${align === "right" ? "left" : "right"};">
        <span style="display:inline-block;background:${palette.gold};color:${palette.ink};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:999px;">${escapeHtml(t("quotation.title"))}</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:34px 36px 8px 36px;" align="${align}">
    <p style="margin:0 0 4px 0;font-size:20px;font-weight:700;color:${palette.ink};">${escapeHtml(t("quotation.email.greeting", { customer }))}</p>
    <p style="margin:0;font-size:14px;line-height:1.7;color:${palette.muted};">${escapeHtml(intro)}</p>
  </td></tr>

  <tr><td style="padding:18px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${palette.line};border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px;background:${palette.goldLight};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${palette.ink};" align="${align}">${escapeHtml(t("quotation.number"))}</td>
        <td style="padding:14px 16px;background:${palette.goldLight};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${palette.ink};" align="${align === "right" ? "left" : "right"}">${escapeHtml(quotation.number)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:${palette.muted};border-top:1px solid ${palette.line};" align="${align}">${escapeHtml(t("quotation.date"))}</td>
        <td style="padding:12px 16px;font-size:13px;color:${palette.ink};border-top:1px solid ${palette.line};" align="${align === "right" ? "left" : "right"}">${escapeHtml(quotation.quotationDate)}</td>
      </tr>
      ${
        quotation.validUntil
          ? `<tr>
        <td style="padding:12px 16px;font-size:13px;color:${palette.muted};border-top:1px solid ${palette.line};" align="${align}">${escapeHtml(t("quotation.validUntil"))}</td>
        <td style="padding:12px 16px;font-size:13px;color:${palette.ink};border-top:1px solid ${palette.line};" align="${align === "right" ? "left" : "right"}">${escapeHtml(quotation.validUntil)}</td>
      </tr>`
          : ""
      }
    </table>
  </td></tr>

  <tr><td style="padding:24px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${palette.line};border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:10px 16px;background:${palette.ink};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;" align="${align}">${escapeHtml(t("quotation.description"))}</td>
        <td style="padding:10px 16px;background:${palette.ink};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;" align="center">${escapeHtml(t("quotation.quantity"))}</td>
        <td style="padding:10px 16px;background:${palette.ink};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;" align="${align === "right" ? "left" : "right"}">${escapeHtml(t("quotation.net"))}</td>
      </tr>
      ${lineRows}
    </table>
  </td></tr>

  <tr><td style="padding:18px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${palette.muted};" align="${align === "right" ? "left" : "right"}">${escapeHtml(t("quotation.net"))}</td>
        <td style="padding:6px 0;font-size:13px;color:${palette.ink};width:120px;" align="${align === "right" ? "left" : "right"}">${escapeHtml(money(quotation.totalNet))}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${palette.muted};" align="${align === "right" ? "left" : "right"}">${escapeHtml(t("quotation.tax"))}</td>
        <td style="padding:6px 0;font-size:13px;color:${palette.ink};" align="${align === "right" ? "left" : "right"}">${escapeHtml(money(quotation.totalTax))}</td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:14px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.ink};border-radius:10px;">
      <tr>
        <td style="padding:16px 20px;color:${palette.gold};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;" align="${align}">${escapeHtml(t("quotation.email.totalLabel"))}</td>
        <td style="padding:16px 20px;color:#ffffff;font-size:20px;font-weight:700;" align="${align === "right" ? "left" : "right"}">${escapeHtml(money(quotation.totalGross))}</td>
      </tr>
    </table>
    <p style="margin:10px 2px 0 2px;font-size:12px;color:${palette.muted};font-style:italic;" align="${align}">${escapeHtml(tafqeetAmount(quotation.totalGross, cur))}</p>
  </td></tr>

  <tr><td style="padding:26px 36px 4px 36px;" align="${align}">
    <p style="margin:0 0 10px 0;font-size:13px;line-height:1.7;color:${palette.muted};">📎 ${escapeHtml(t("quotation.email.viewAttached"))}</p>
    <p style="margin:0 0 18px 0;font-size:13px;line-height:1.7;color:${palette.muted};">${escapeHtml(t("quotation.email.closing"))}</p>
    <p style="margin:0;font-size:13px;color:${palette.ink};">${escapeHtml(t("quotation.email.regards"))}<br/><strong>${escapeHtml(params.companyName)}</strong></p>
  </td></tr>

  <tr><td style="padding:22px 36px;background:${palette.paper};border-top:1px solid ${palette.line};" align="center">
    <p style="margin:0;font-size:11px;color:${palette.muted};">${[params.sellerPhone, params.sellerAddress].filter((v): v is string => Boolean(v)).map(escapeHtml).join(" · ")}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    t("quotation.email.greeting", { customer }),
    intro,
    `${t("quotation.number")}: ${quotation.number}`,
    `${t("quotation.email.totalLabel")}: ${money(quotation.totalGross)}`,
    tafqeetAmount(quotation.totalGross, cur),
    t("quotation.email.viewAttached"),
    t("quotation.email.closing"),
    t("quotation.email.regards"),
    params.companyName,
  ].join("\n\n");

  return { subject, html, text };
}
