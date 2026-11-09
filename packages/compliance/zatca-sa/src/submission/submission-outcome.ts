// Maps a ZATCA API response (or a transport-level failure) onto the country-agnostic
// ComplianceOutcome (docs/06-COMPLIANCE-PACK-RULES.md §2) plus the richer detail this package
// persists to ZatcaInvoiceRecord. docs/06 §7: "Never fabricate a clearance status" — every branch
// below is a direct read of what ZATCA (or the transport) actually said, never assumed.
import type { ComplianceOutcome } from "@erp/compliance-contract";
import { ZatcaApiError, type ClearanceResponseBody, type ReportingResponseBody } from "./zatca-api-client.js";

export interface SubmissionOutcome {
  readonly complianceOutcome: ComplianceOutcome;
  readonly clearedXml: string | null; // decoded from base64; standard (clearance) only
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly rawResponse: unknown;
}

export function classifyClearanceResponse(response: ClearanceResponseBody): SubmissionOutcome {
  const { warningMessages: warnings, errorMessages: errors } = response.validationResults;
  if (response.clearanceStatus === "CLEARED") {
    const complianceOutcome: ComplianceOutcome = warnings.length > 0 ? { kind: "ACCEPTED_WITH_WARNINGS", warnings } : { kind: "CLEARED" };
    return { complianceOutcome, clearedXml: response.clearedInvoice ? Buffer.from(response.clearedInvoice, "base64").toString("utf8") : null, warnings, errors, rawResponse: response };
  }
  return { complianceOutcome: { kind: "REJECTED", reason: errors[0] ?? "ZATCA did not clear the invoice" }, clearedXml: null, warnings, errors, rawResponse: response };
}

export function classifyReportingResponse(response: ReportingResponseBody): SubmissionOutcome {
  const { warningMessages: warnings, errorMessages: errors } = response.validationResults;
  if (response.reportingStatus === "REPORTED") {
    const complianceOutcome: ComplianceOutcome = warnings.length > 0 ? { kind: "ACCEPTED_WITH_WARNINGS", warnings } : { kind: "REPORTED" };
    return { complianceOutcome, clearedXml: null, warnings, errors, rawResponse: response };
  }
  return { complianceOutcome: { kind: "REJECTED", reason: errors[0] ?? "ZATCA did not accept the report" }, clearedXml: null, warnings, errors, rawResponse: response };
}

// docs/06 §4: "Retry only on transient errors... never blindly retry 400s." Three different
// outcomes, not two — getting this wrong either burns an ICV on a problem that was never the
// invoice's fault, or retries something retrying can never fix:
//   - transient (network/5xx/429): PENDING_RETRY — the ICV is NOT consumed, retry the identical
//     submission.
//   - AUTH_ERROR (401/403): PACK_UNAVAILABLE — our own credentials/config are wrong, not a
//     judgement ZATCA made about this invoice. Retrying the identical request won't help either,
//     but the ICV must not be burned over what is an operational misconfiguration, not a
//     business rejection; this needs a human to fix the credentials, then a normal retry.
//   - anything else (a genuine 4xx ZATCA validation failure): REJECTED, same as a business
//     rejection — the ICV IS consumed, and a correction is a new document, not a resubmission.
export function classifyError(error: unknown): SubmissionOutcome {
  if (error instanceof ZatcaApiError) {
    const rawResponse = { code: error.code, status: error.status, body: error.body };
    if (error.isTransient) {
      return { complianceOutcome: { kind: "PENDING_RETRY" }, clearedXml: null, warnings: [], errors: [error.message], rawResponse };
    }
    if (error.code === "AUTH_ERROR") {
      return { complianceOutcome: { kind: "PACK_UNAVAILABLE" }, clearedXml: null, warnings: [], errors: [error.message], rawResponse };
    }
    return { complianceOutcome: { kind: "REJECTED", reason: error.message }, clearedXml: null, warnings: [], errors: [error.message], rawResponse };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { complianceOutcome: { kind: "REJECTED", reason: message }, clearedXml: null, warnings: [], errors: [message], rawResponse: undefined };
}
