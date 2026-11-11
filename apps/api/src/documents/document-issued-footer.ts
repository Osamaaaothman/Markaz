import { escapeHtml } from "../common/html-escape.js";
import type { SupportedDocumentLanguage } from "../i18n/server-i18n.js";

export function formatIssuedAt(
  value: string,
  language: SupportedDocumentLanguage,
  timeZone = "Asia/Riyadh",
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
export function issuedFooter(
  params: {
    issuedBy?: string | null;
    issuedAt?: string | null;
    language: SupportedDocumentLanguage;
  },
  labels: { issuedBy: string; issuedAt: string; notice: string },
): string {
  return `<div class="issued-by-block">${params.issuedBy ? `<span><strong>${escapeHtml(labels.issuedBy)}</strong><bdi dir="ltr">${escapeHtml(params.issuedBy)}</bdi></span>` : ""}${params.issuedAt ? `<span><strong>${escapeHtml(labels.issuedAt)}</strong><bdi>${escapeHtml(formatIssuedAt(params.issuedAt, params.language))}</bdi></span>` : ""}</div><p class="computer-generated">${escapeHtml(labels.notice)}</p>`;
}
