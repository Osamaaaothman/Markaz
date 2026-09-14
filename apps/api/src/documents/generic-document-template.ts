import { getDocumentTranslator, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";
import { escapeHtml } from "../common/html-escape.js";

export interface GenericDocumentParams {
  readonly language: SupportedDocumentLanguage;
  readonly recipientName: string;
  readonly companyName: string;
  readonly message: string;
}

// The one example bilingual document template proving the rendering pipeline
// works (renderHtmlToPdf + real Arabic shaping) — deliberately generic, not an
// invoice. A real invoice/quotation layout is M6 (Sales) work, once tax lines,
// totals, and ZATCA QR placement are actual requirements, not guesses.
//
// docs/08-FRONTEND-I18N-RULES.md §4: "Use logical CSS properties everywhere...
// Never margin-left/right: for layout" — this applies to a server-rendered PDF
// exactly as much as a browser screen.
export async function renderGenericDocument(params: GenericDocumentParams): Promise<string> {
  const t = await getDocumentTranslator(params.language);
  const dir = params.language === "ar" ? "rtl" : "ltr";

  const greeting = t("generic.greeting", { name: params.recipientName });
  const body = t("notice.body", { message: params.message });
  const footer = t("generic.footer", { companyName: params.companyName });
  const title = t("notice.subject", { companyName: params.companyName });

  return `<!doctype html>
<html lang="${params.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 24mm 18mm; }
  body {
    font-family: "Segoe UI", "Noto Sans Arabic", sans-serif;
    color: #1a1a1a;
    margin: 0;
  }
  h1 { font-size: 18pt; margin-block-end: 12pt; }
  p { font-size: 11pt; line-height: 1.6; margin-block-end: 8pt; text-align: start; }
  .company-name { font-weight: 600; }
  footer {
    margin-block-start: 24pt;
    padding-block-start: 8pt;
    border-block-start: 1px solid #ccc;
    color: #666;
    font-size: 9pt;
  }
</style>
</head>
<body>
<h1 class="company-name">${escapeHtml(params.companyName)}</h1>
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(body)}</p>
<footer>${escapeHtml(footer)}</footer>
</body>
</html>`;
}
