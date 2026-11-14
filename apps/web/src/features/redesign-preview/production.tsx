// Local-only harness for the actual shell, settings and component reference.
// No app routes or authentication gate are replaced; the production entry never imports this.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrimeReactProvider } from "primereact/api";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "../../shared/i18n/config";
import "../../design/styles";
import { useTranslation } from "react-i18next";
import { AppShell } from "../../app/layout/AppShell";
import { NAV_ITEMS } from "../../app/layout/NavConfig";
import { InterfaceSettingsPage } from "../settings/InterfaceSettingsPage";
import { DesignSystemPage } from "../design-system/DesignSystemPage";
import { usePrimeTheme } from "../../shared/theme/use-prime-theme";
import { usePrimeLocale } from "../../shared/prime/use-prime-locale";
import { useDocumentDirection } from "../../shared/i18n/use-document-direction";

// Disabled queries use sample cache data. No token is created and no API is called.
const fixtureClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});
fixtureClient.setQueryData(["currentUser"], {
  id: "preview",
  email: "preview@example.test",
  companyId: "",
  companyName: "Preview workspace",
  companyNameAr: "مساحة تجريبية",
  companyDefaultCurrency: "SAR",
  ref: "PREVIEW",
  roles: [],
  permissions: [...new Set(NAV_ITEMS.flatMap((item) => item.permissions ?? []))],
});
fixtureClient.setQueryData(["purchasingCounts"], {});

function Review(): React.JSX.Element {
  const { i18n } = useTranslation();
  return (
    <>
      <p role="note" className="mk-direction-hint">
        {i18n.language === "ar"
          ? "معاينة محلية للواجهة الفعلية • بيانات تجريبية • إعدادات المظهر محفوظة في هذا المتصفح"
          : "Local preview of the actual interface · Sample data · Appearance saved in this browser"}
      </p>
      <InterfaceSettingsPage />
      <div style={{ marginBlockStart: "2rem" }}>
        <DesignSystemPage />
      </div>
    </>
  );
}

function ProductionPreview(): React.JSX.Element {
  usePrimeTheme();
  usePrimeLocale();
  useDocumentDirection();
  return (
    <PrimeReactProvider value={{ ripple: false }}>
      <QueryClientProvider client={fixtureClient}>
        <MemoryRouter initialEntries={["/settings/interface"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<Review />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </PrimeReactProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProductionPreview />
  </StrictMode>,
);
