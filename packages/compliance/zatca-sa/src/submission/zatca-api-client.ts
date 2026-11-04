// The Fatoora Reporting/Clearance HTTP client. Headers and the request/response JSON shape
// below are // REVIEW: not yet confirmed against ZATCA's own Integration Sandbox swagger (not
// reachable by this tool) — built from this task's starting brief plus consistent third-party
// integration write-ups (multiple independent vendor docs agree on the shape), pending that
// confirmation (docs/06-COMPLIANCE-PACK-RULES.md §0). Shared HTTP transport/error classification
// lives in ../http/zatca-http-transport.ts (also used by ../onboarding/).
import { ZATCA_BASE_URL, type ZatcaEnvironment } from "./zatca-environment.js";
import { FetchHttpTransport, classifyErrorStatus, DEFAULT_ZATCA_TIMEOUT_MS, type HttpTransport } from "../http/zatca-http-transport.js";

// Re-exported so existing imports of `ZatcaApiError`/`HttpResponse`/`HttpTransport` from this
// module keep working now that they live in the shared ../http/ module (also used by
// ../onboarding/).
export { ZatcaApiError, FetchHttpTransport } from "../http/zatca-http-transport.js";
export type { HttpResponse, HttpTransport } from "../http/zatca-http-transport.js";

export interface ZatcaCredentials {
  readonly binarySecurityToken: string;
  readonly secret: string;
}

export interface ClearanceRequestBody {
  readonly invoiceHash: string;
  readonly uuid: string;
  readonly invoice: string; // base64 of the signed invoice XML
}

export interface ValidationResults {
  readonly status: string;
  readonly warningMessages: readonly string[];
  readonly errorMessages: readonly string[];
}

export interface ClearanceResponseBody {
  readonly clearanceStatus: "CLEARED" | "NOT_CLEARED";
  readonly clearedInvoice: string | null; // base64, present only when cleared
  readonly validationResults: ValidationResults;
}

export interface ReportingResponseBody {
  readonly reportingStatus: "REPORTED" | "NOT_REPORTED";
  readonly validationResults: ValidationResults;
}

function authHeader(credentials: ZatcaCredentials): string {
  return `Basic ${Buffer.from(`${credentials.binarySecurityToken}:${credentials.secret}`).toString("base64")}`;
}

function commonHeaders(credentials: ZatcaCredentials, acceptLanguage: "ar" | "en"): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Version": "V2",
    "Accept-Language": acceptLanguage,
    Authorization: authHeader(credentials),
  };
}

export class ZatcaApiClient {
  constructor(
    private readonly environment: ZatcaEnvironment,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
    private readonly timeoutMs: number = DEFAULT_ZATCA_TIMEOUT_MS,
  ) {}

  // B2B (standard): the invoice is not legally valid until cleared.
  async clearInvoice(credentials: ZatcaCredentials, body: ClearanceRequestBody, acceptLanguage: "ar" | "en" = "en"): Promise<ClearanceResponseBody> {
    const url = `${ZATCA_BASE_URL[this.environment]}/invoices/clearance/single`;
    const headers = { ...commonHeaders(credentials, acceptLanguage), "Clearance-Status": "1" };
    const response = await this.transport.request("POST", url, headers, body, this.timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      throw classifyErrorStatus(response.status, response.body);
    }
    return response.body as ClearanceResponseBody;
  }

  // B2C (simplified): reported within 24 hours of issuance, not cleared before issuing.
  async reportInvoice(credentials: ZatcaCredentials, body: ClearanceRequestBody, acceptLanguage: "ar" | "en" = "en"): Promise<ReportingResponseBody> {
    const url = `${ZATCA_BASE_URL[this.environment]}/invoices/reporting/single`;
    const headers = commonHeaders(credentials, acceptLanguage);
    const response = await this.transport.request("POST", url, headers, body, this.timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      throw classifyErrorStatus(response.status, response.body);
    }
    return response.body as ReportingResponseBody;
  }
}
