import "./shared/i18n/config";
import "./design/styles";
import { useDocumentDirection } from "./shared/i18n/use-document-direction";
import { usePrimeTheme } from "./shared/theme/use-prime-theme";
import { AppProviders } from "./app/AppProviders";
import { AppRoutes } from "./app/AppRoutes";
import { SplashScreen } from "./shared/ui/SplashScreen";

export function App(): React.JSX.Element {
  useDocumentDirection();
  usePrimeTheme();
  return (
    <AppProviders>
      <SplashScreen />
      <AppRoutes />
    </AppProviders>
  );
}
