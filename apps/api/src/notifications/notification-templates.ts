import { getDocumentTranslator, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { escapeHtml } from "../common/html-escape.js";
import type { EmailMessage } from "./email-transport.js";
import { renderEmailShell } from "./email-shell.js";

export interface GenericNoticeParams {
  readonly language: SupportedDocumentLanguage;
  readonly to: string;
  readonly recipientName: string;
  readonly companyName: string;
  readonly message: string;
}

// docs/08-FRONTEND-I18N-RULES.md §4: "email templates need RTL treatment too —
// they are the most commonly forgotten." `dir` is derived from the language, never
// assumed LTR. This is deliberately the ONE generic template for now — a
// dispatch-by-key template registry is not justified (CLAUDE.md §7) until a real
// second template exists (an invoice email, M6).
export async function renderGenericNotice(params: GenericNoticeParams): Promise<EmailMessage> {
  const t = await getDocumentTranslator(params.language);

  const greeting = t("generic.greeting", { name: params.recipientName });
  const body = t("notice.body", { message: params.message });
  const footer = t("generic.footer", { companyName: params.companyName });
  const subject = t("notice.subject", { companyName: params.companyName });

  const html = renderEmailShell({
    language: params.language, companyName: params.companyName, subject, label: subject, preview: body,
    bodyHtml: `<h1 style="font-size:20px;line-height:1.5;margin:0 0 16px;">${escapeHtml(greeting)}</h1><p style="font-size:14px;white-space:pre-line;margin:0;color:#52645b;">${escapeHtml(body)}</p>`,
    footerHtml: escapeHtml(footer),
  });

  const text = `${greeting}\n\n${body}\n\n---\n${footer}`;

  return { to: params.to, subject, html, text };
}
