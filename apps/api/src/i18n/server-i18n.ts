import i18next, { type TFunction } from "i18next";
import enDocuments from "./locales/en/documents.json";
import arDocuments from "./locales/ar/documents.json";

// docs/08-FRONTEND-I18N-RULES.md §3 applies to server-rendered documents (email,
// PDF) too — "no hard-coded user-facing string... only translation keys." This is
// the backend counterpart to apps/web/src/shared/i18n/config.ts, a SEPARATE
// namespace ("documents") since transactional-document copy and UI copy evolve
// independently and are reviewed by different people.
//
// docs/08 §3.5: "Pluralisation and interpolation go through i18next... Arabic has
// more plural forms than English" — this applies just as much to a bilingual PDF
// or an email body as it does to a UI string, so the server reuses the same
// library rather than hand-rolling string interpolation.
export const SUPPORTED_DOCUMENT_LANGUAGES = ["ar", "en"] as const;
export type SupportedDocumentLanguage = (typeof SUPPORTED_DOCUMENT_LANGUAGES)[number];

let initPromise: Promise<TFunction> | null = null;

async function ensureInitialized(): Promise<void> {
  if (i18next.isInitialized) {
    return;
  }
  initPromise ??= i18next.init({
    resources: {
      en: { documents: enDocuments },
      ar: { documents: arDocuments },
    },
    lng: "en",
    fallbackLng: "en",
    defaultNS: "documents",
    interpolation: { escapeValue: false }, // Callers HTML-escape where relevant.
    returnNull: false,
  });
  await initPromise;
}

// A Node process serves every recipient's locale concurrently — i18next's global
// `t()`/`changeLanguage()` is a single shared "current language" and is NOT safe
// to call per-request here. `getFixedT` returns a translator bound to one
// language, with no shared mutable state between callers
// (https://www.i18next.com/overview/api#getfixedt).
export async function getDocumentTranslator(
  language: SupportedDocumentLanguage,
): Promise<TFunction> {
  await ensureInitialized();
  return i18next.getFixedT(language, "documents");
}
