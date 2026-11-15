import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PrimeReactProvider } from "primereact/api";
import { usePrimeLocale } from "./use-prime-locale";

function LocaleSync(): null {
  usePrimeLocale();
  return null;
}

// PrimeReact 10 keeps locale in its provider state. Updating only the legacy
// global leaves nested controls and portal accessibility labels in English.
export function PrimeProvider({
  children,
  ripple = true,
}: {
  children: ReactNode;
  ripple?: boolean;
}): React.JSX.Element {
  const { i18n } = useTranslation();
  return (
    <PrimeReactProvider value={{ ripple, locale: i18n.language.startsWith("ar") ? "ar" : "en" }}>
      <LocaleSync />
      {children}
    </PrimeReactProvider>
  );
}
