// ZATCA's three environments. // REVIEW: docs/06-COMPLIANCE-PACK-RULES.md §0 — these base URLs
// and certificate template names come from this task's own starting brief and consistent
// third-party integration write-ups, not from the Integration Sandbox's own swagger files (not
// reachable by this tool; ADR-0004 already flagged this as needed from Osama's browser). Confirm
// against the real swagger/Data Dictionary before a production go-live; wrong by one path
// segment and every call in this file 404s.
export type ZatcaEnvironment = "sandbox" | "simulation" | "production";

export const ZATCA_BASE_URL: Record<ZatcaEnvironment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

export const ZATCA_CSR_CERTIFICATE_TEMPLATE: Record<ZatcaEnvironment, string> = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing",
};
