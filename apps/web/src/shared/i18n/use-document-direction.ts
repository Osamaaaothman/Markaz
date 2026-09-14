import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RTL_LANGUAGES, type SupportedLanguage } from "./config";

// docs/08-FRONTEND-I18N-RULES.md §4: "Direction is driven by locale:
// <html dir='rtl' lang='ar'>." This is the one place that attribute is set — no
// component should touch document.documentElement.dir/.lang directly.
export function useDocumentDirection(): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    const applyDirection = (language: string): void => {
      const lang = language as SupportedLanguage;
      document.documentElement.lang = lang;
      document.documentElement.dir = RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
    };

    applyDirection(i18n.language);
    i18n.on("languageChanged", applyDirection);
    return () => {
      i18n.off("languageChanged", applyDirection);
    };
  }, [i18n]);
}
