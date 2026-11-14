import { escapeHtml } from "../common/html-escape.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";

/** Inline styles and presentation tables survive email clients without grid/flex support. */
export function renderEmailShell(params: {
  readonly language: SupportedDocumentLanguage;
  readonly subject: string;
  readonly companyName: string;
  readonly label: string;
  readonly preview: string;
  readonly bodyHtml: string;
  readonly footerHtml: string;
  readonly logoDataUri?: string | undefined;
}): string {
  const dir = params.language === "ar" ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const logo = params.logoDataUri?.match(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/) ? params.logoDataUri : null;
  return `<!doctype html><html lang="${params.language}" dir="${dir}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(params.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f4;font-family:Arial,'Segoe UI',sans-serif;color:#263730;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(params.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;table-layout:fixed;"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" dir="${dir}" style="width:100%;max-width:640px;table-layout:fixed;overflow-wrap:anywhere;background:#fff;border:1px solid #dce3df;border-top:3px solid #244f43;">
<tr><td style="padding:24px 24px 20px;border-bottom:1px solid #e5eae7;" align="${align}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td align="${align}" style="vertical-align:middle;"><p style="margin:0 0 5px;font-size:19px;font-weight:700;line-height:1.5;color:#244f43;">${escapeHtml(params.companyName)}</p><p style="margin:0;font-size:12px;color:#65746c;">${escapeHtml(params.label)}</p></td>
${logo ? `<td width="88" style="vertical-align:middle;padding:0 6px;" align="center"><img src="${escapeHtml(logo)}" alt="${escapeHtml(params.companyName)}" width="80" style="display:block;width:80px;max-height:80px;object-fit:contain;border:0;"/></td>` : ""}
</tr></table></td></tr>
<tr><td align="${align}" style="padding:26px 24px;line-height:1.75;">${params.bodyHtml}</td></tr>
<tr><td align="center" style="padding:18px 24px;border-top:1px solid #e5eae7;color:#65746c;font-size:11px;line-height:1.7;">${params.footerHtml}</td></tr>
</table></td></tr></table></body></html>`;
}
