// Maps a ZATCA API response (or a transport-level failure) onto the country-agnostic
// ComplianceOutcome (docs/06-COMPLIANCE-PACK-RULES.md §2) plus the richer detail this package
// persists to ZatcaInvoiceRecord. docs/06 §7: "Never fabricate a clearance status" — every branch
// below is a direct read of what ZATCA (or the transport) actually said, never assumed.
import type { ComplianceOutcome } from "@erp/compliance-contract";
import { ZatcaApiError, type ClearanceResponseBody, type ReportingResponseBody } from "./zatca-api-client.js";
import { providerValidationMessages, validationMessages } from "./validation-messages.js";

export interface SubmissionOutcome {
  readonly complianceOutcome: ComplianceOutcome;
  readonly clearedXml: string | null; // decoded from base64; standard (clearance) only
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly rawResponse: unknown;
}

export function classifyClearanceResponse(response: ClearanceResponseBody): SubmissionOutcome {
  const warnings = validationMessages(response.validationResults.warningMessages);
  const errors = validationMessages(response.validationResults.errorMessages);
  if (response.clearanceStatus === "CLEARED") {
    const complianceOutcome: ComplianceOutcome = warnings.length > 0 ? { kind: "ACCEPTED_WITH_WARNINGS", warnings } : { kind: "CLEARED" };
    return { complianceOutcome, clearedXml: response.clearedInvoice ? Buffer.from(response.clearedInvoice, "base64").toString("utf8") : null, warnings, errors, rawResponse: response };
  }
  return { complianceOutcome: { kind: "REJECTED", reason: errors[0] ?? "ZATCA did not clear the invoice" }, clearedXml: null, warnings, errors, rawResponse: response };
}

export function classifyReportingResponse(response: ReportingResponseBody): SubmissionOutcome {
  const warnings = validationMessages(response.validationResults.warningMessages);
  const errors = validationMessages(response.validationResults.errorMessages);
  if (response.reportingStatus === "REPORTED") {
    const complianceOutcome: ComplianceOutcome = warnings.length > 0 ? { kind: "ACCEPTED_WITH_WARNINGS", warnings } : { kind: "REPORTED" };
    return { complianceOutcome, clearedXml: null, warnings, errors, rawResponse: response };
  }
  return { complianceOutcome: { kind: "REJECTED", reason: errors[0] ?? "ZATCA did not accept the report" }, clearedXml: null, warnings, errors, rawResponse: response };
}

// docs/06 §4: "Retry only on transient errors... never blindly retry 400s." Three different
// outcomes, not two. Generation has already consumed the ICV; transport outcomes only
// determine whether those same document bytes may be retried:
//   - transient (network/5xx/429): PENDING_RETRY — retry the identical submission.
//   - AUTH_ERROR (401/403): PACK_UNAVAILABLE — our own credentials/config are wrong, not a
//     judgement ZATCA made about this invoice. Retrying the identical request won't help either,
//     so fix the credentials, then retry the same document without allocating another ICV.
//   - anything else (a genuine 4xx ZATCA validation failure): REJECTED, same as a business
//     rejection — a correction is a new document, not a resubmission.
export function classifyError(error: unknown): SubmissionOutcome {
  if (error instanceof ZatcaApiError) {
    const feedback = providerValidationMessages(error.body);
    const errors = feedback.errors.length ? feedback.errors : [error.message];
    const warnings = feedback.warnings;
    const rawResponse = { code: error.code, status: error.status, body: error.body };
    if (error.isTransient) {
      return { complianceOutcome: { kind: "PENDING_RETRY" }, clearedXml: null, warnings, errors, rawResponse };
    }
    if (error.code === "AUTH_ERROR") {
      return { complianceOutcome: { kind: "PACK_UNAVAILABLE" }, clearedXml: null, warnings, errors, rawResponse };
    }
    return { complianceOutcome: { kind: "REJECTED", reason: errors[0]! }, clearedXml: null, warnings, errors, rawResponse };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { complianceOutcome: { kind: "PACK_UNAVAILABLE" }, clearedXml: null, warnings: [], errors: [message], rawResponse: undefined };
}
