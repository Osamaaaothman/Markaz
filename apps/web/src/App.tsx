import "./shared/i18n/config";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "@fontsource/ibm-plex-sans-arabic/latin-400.css";
import "@fontsource/ibm-plex-sans-arabic/latin-500.css";
import "@fontsource/ibm-plex-sans-arabic/latin-600.css";
import "@fontsource/ibm-plex-sans-arabic/latin-700.css";
import "./design/tokens.css";
import "./design/base.css";
import "./app/app.css";
import "./design/shell.css";
import "./design/components.css";
import "./design/pages.css";
import "./design/motion.css";
import { useDocumentDirection } from "./shared/i18n/use-document-direction";
import { usePrimeTheme } from "./shared/theme/use-prime-theme";
import { AppProviders } from "./app/AppProviders";
import { AppRoutes } from "./app/AppRoutes";

export function App(): React.JSX.Element {
  useDocumentDirection();
  usePrimeTheme();
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
