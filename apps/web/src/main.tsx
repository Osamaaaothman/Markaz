import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { App } from "./App";
import { startQueryPersistence } from "./shared/offline/query-persistence";
import { listenForInstallPrompt } from "./shared/pwa/pwa-install-store";
import { registerServiceWorker } from "./shared/pwa/register-service-worker";

startQueryPersistence();
// Both before the first render: the browser fires `beforeinstallprompt` only once and may do so early.
listenForInstallPrompt();
registerServiceWorker();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
