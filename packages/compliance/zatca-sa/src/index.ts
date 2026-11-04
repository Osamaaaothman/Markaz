// Saudi (ZATCA) compliance pack — implements @erp/compliance-contract.
// docs/01-OPEN-DECISIONS.md A4 settled (direct integration, 2026-10-07) and
// docs/06-COMPLIANCE-PACK-RULES.md §0's verification step done for M7 Phase 1 — real work
// started. "ZATCA" appears only in this package, never in core/ or any other module
// (docs/06 §1).
export * from "./key-encryption.js";
export * from "./egs-chain.service.js";
export * from "./xml/invoice-xml.types.js";
export * from "./xml/invoice-xml-builder.js";
export * from "./xml/canonicalize.js";
export * from "./xml/invoice-hash.js";
export * from "./xml/qr.js";
export * from "./xml/signing.js";
export * from "./xml/xades-signature.js";
export * from "./http/zatca-http-transport.js";
export * from "./submission/zatca-environment.js";
// Not `export *` from zatca-api-client.js: it re-exports ZatcaApiError/FetchHttpTransport/
// HttpResponse/HttpTransport from zatca-http-transport.js for backward compatibility within
// this package, and `export *` silently drops any name two modules both star-export — so list
// this module's own names explicitly instead.
export { ZatcaApiClient, type ZatcaCredentials, type ClearanceRequestBody, type ValidationResults, type ClearanceResponseBody, type ReportingResponseBody } from "./submission/zatca-api-client.js";
export * from "./submission/submission-outcome.js";
export * from "./submission/invoice-submission.service.js";
export * from "./onboarding/csr.js";
// Same reasoning as zatca-api-client.js above — onboarding-api-client.js imports (but does not
// re-export) ZatcaCredentials/ClearanceRequestBody/ValidationResults from zatca-api-client.js,
// so `export *` here is safe; it only re-exports its own CsidResponseBody/
// ComplianceCheckResponseBody/ZatcaOnboardingApiClient.
export * from "./onboarding/onboarding-api-client.js";
export * from "./onboarding/onboarding.service.js";
