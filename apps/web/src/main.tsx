import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
