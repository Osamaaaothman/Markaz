import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "../../locales/en/common.json";
import arCommon from "../../locales/ar/common.json";

// docs/08-FRONTEND-I18N-RULES.md §3: "ar and en are updated in the same commit."
// This is the one place locale resources are registered — a new feature adds its
// own namespace file under locales/<lang>/<feature>.json and lists it here in both
// languages; a hard-coded string anywhere else is a defect, not a shortcut.
export const SUPPORTED_LANGUAGES = ["ar", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
// ERP-Lite's primary market is Saudi Arabia (docs/00-PRODUCT-BRIEF.md) — Arabic is
// the default, English is fully supported, never a second-class fallback.
export const DEFAULT_LANGUAGE: SupportedLanguage = "ar";
export const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(["ar"]);

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    ar: { common: arCommon },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false }, // React already escapes — docs/08 §3.5.
  returnNull: false,
});

export default i18n;
