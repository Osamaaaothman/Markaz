import { classifyError } from "./submission-outcome.js";
import { ZatcaApiError } from "./zatca-api-client.js";
import { providerAcceptanceStatus, providerValidationMessages } from "./validation-messages.js";

const body = { validationResults: { errorMessages: [{ code: "certificate-permissions", message: "Seller VAT does not match the authentication certificate" }], warningMessages: [{ code: "warning-code", message: "Review seller address" }] }, secret: "must-not-be-displayed" };

it("preserves a live 400 validation reason and warnings while keeping the rejection definitive", () => {
  const outcome = classifyError(new ZatcaApiError("CLIENT_ERROR", "HTTP 400", 400, body));
  expect(outcome.complianceOutcome).toEqual({ kind: "REJECTED", reason: "certificate-permissions: Seller VAT does not match the authentication certificate" });
  expect(outcome.errors).toEqual(["certificate-permissions: Seller VAT does not match the authentication certificate"]);
  expect(outcome.warnings).toEqual(["warning-code: Review seller address"]);
  expect(outcome.rawResponse).toEqual({ code: "CLIENT_ERROR", status: 400, body });
  expect(JSON.stringify({ errors: outcome.errors, warnings: outcome.warnings })).not.toContain("must-not-be-displayed");
});

it("recovers feedback from persisted legacy response envelopes without exposing unrelated fields", () => {
  expect(providerValidationMessages({ code: "CLIENT_ERROR", body })).toEqual(providerValidationMessages(body));
  expect(JSON.stringify(providerValidationMessages(body))).not.toContain("must-not-be-displayed");
  for (const value of [null, "not JSON", [], { body: "not JSON" }, { validationResults: null }]) expect(providerValidationMessages(value)).toEqual({ errors: [], warnings: [] });
});

it("retains retry and authentication classifications when a structured validation response is absent", () => {
  expect(classifyError(new ZatcaApiError("TIMEOUT", "timed out")).complianceOutcome).toEqual({ kind: "PENDING_RETRY" });
  const auth = classifyError(new ZatcaApiError("AUTH_ERROR", "invalid credentials", 401));
  expect(auth.complianceOutcome).toEqual({ kind: "PACK_UNAVAILABLE" });
  expect(auth.errors).toEqual(["invalid credentials"]);
});

it("retains the explicit authority acceptance when validation warnings accompany it", () => {
  expect(providerAcceptanceStatus({ clearanceStatus: "CLEARED", validationResults: { warningMessages: ["Review delivery date"] } })).toBe("CLEARED");
  expect(providerAcceptanceStatus({ reportingStatus: "REPORTED" })).toBe("REPORTED");
  for (const value of [null, [], "CLEARED", { clearanceStatus: "NOT_CLEARED" }, { reportingStatus: "NOT_REPORTED" }, { body: { clearanceStatus: "CLEARED" } }]) expect(providerAcceptanceStatus(value)).toBeNull();
});
