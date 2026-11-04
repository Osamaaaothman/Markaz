// The Fatoora Reporting/Clearance HTTP client. Headers and the request/response JSON shape
// below are // REVIEW: not yet confirmed against ZATCA's own Integration Sandbox swagger (not
// reachable by this tool) — built from this task's starting brief plus consistent third-party
// integration write-ups (multiple independent vendor docs agree on the shape), pending that
// confirmation (docs/06-COMPLIANCE-PACK-RULES.md §0). Uses Node's built-in `fetch` — no new
// dependency needed. A pluggable `HttpTransport` keeps every test (and all of CI) off the real
// network: docs/06 §6 "Never call the production ZATCA environment from tests. Use the sandbox,
// and a mock adapter by default in CI" — the mock adapter is this interface's whole point.
import { ZATCA_BASE_URL, type ZatcaEnvironment } from "./zatca-environment.js";

export class ZatcaApiError extends Error {
  constructor(
    readonly code: "TIMEOUT" | "NETWORK_ERROR" | "AUTH_ERROR" | "SERVER_ERROR" | "RATE_LIMITED" | "CLIENT_ERROR",
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ZatcaApiError";
  }

  // docs/06 §4: "Retry only on transient errors (network, 5xx, 429); never blindly retry 400s."
  get isTransient(): boolean {
    return this.code === "TIMEOUT" || this.code === "NETWORK_ERROR" || this.code === "SERVER_ERROR" || this.code === "RATE_LIMITED";
  }
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

// What a real HTTP call needs; swappable for a mock in every test.
export interface HttpTransport {
  postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpResponse>;
}

export class FetchHttpTransport implements HttpTransport {
  async postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsedBody: unknown = text;
      try {
        parsedBody = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        // Not JSON — leave as raw text; the caller's error classification can still use `status`.
      }
      return { status: response.status, body: parsedBody };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ZatcaApiError("TIMEOUT", `ZATCA API call to ${url} did not respond within ${String(timeoutMs)}ms`);
      }
      throw new ZatcaApiError("NETWORK_ERROR", `ZATCA API call to ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

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

const DEFAULT_TIMEOUT_MS = 20_000;

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

// Any non-2xx is classified by status code, not swallowed into a generic failure — the caller
// needs to know whether a retry is ever worth attempting.
function classifyErrorStatus(status: number, body: unknown): ZatcaApiError {
  if (status === 401 || status === 403) return new ZatcaApiError("AUTH_ERROR", `ZATCA authentication failed (HTTP ${String(status)})`, status, body);
  if (status === 429) return new ZatcaApiError("RATE_LIMITED", `ZATCA rate-limited the request (HTTP 429)`, status, body);
  if (status >= 500) return new ZatcaApiError("SERVER_ERROR", `ZATCA server error (HTTP ${String(status)})`, status, body);
  return new ZatcaApiError("CLIENT_ERROR", `ZATCA rejected the request (HTTP ${String(status)})`, status, body);
}

export class ZatcaApiClient {
  constructor(
    private readonly environment: ZatcaEnvironment,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  // B2B (standard): the invoice is not legally valid until cleared.
  async clearInvoice(credentials: ZatcaCredentials, body: ClearanceRequestBody, acceptLanguage: "ar" | "en" = "en"): Promise<ClearanceResponseBody> {
    const url = `${ZATCA_BASE_URL[this.environment]}/invoices/clearance/single`;
    const headers = { ...commonHeaders(credentials, acceptLanguage), "Clearance-Status": "1" };
    const response = await this.transport.postJson(url, headers, body, this.timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      throw classifyErrorStatus(response.status, response.body);
    }
    return response.body as ClearanceResponseBody;
  }

  // B2C (simplified): reported within 24 hours of issuance, not cleared before issuing.
  async reportInvoice(credentials: ZatcaCredentials, body: ClearanceRequestBody, acceptLanguage: "ar" | "en" = "en"): Promise<ReportingResponseBody> {
    const url = `${ZATCA_BASE_URL[this.environment]}/invoices/reporting/single`;
    const headers = commonHeaders(credentials, acceptLanguage);
    const response = await this.transport.postJson(url, headers, body, this.timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      throw classifyErrorStatus(response.status, response.body);
    }
    return response.body as ReportingResponseBody;
  }
}
