import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PrimeReactProvider } from "primereact/api";
import { usePrimeLocale } from "./use-prime-locale";

const motionQuery = "(prefers-reduced-motion: reduce)";
const reducedMotion = (): boolean => window.matchMedia(motionQuery).matches;
const subscribeMotion = (notify: () => void): (() => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const serverMotion = (): boolean => false;

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
  const reduceMotion = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  return (
    <PrimeReactProvider value={{ ripple: ripple && !reduceMotion, cssTransition: !reduceMotion, locale: i18n.language.startsWith("ar") ? "ar" : "en" }}>
      <LocaleSync />
      {children}
    </PrimeReactProvider>
  );
}
