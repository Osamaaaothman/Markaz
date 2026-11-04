// The HTTP transport shared by onboarding (Phase 2) and submission (Phase 5) — one error
// classification, one pluggable transport interface, so every test (and all of CI) stays off
// the real network (docs/06-COMPLIANCE-PACK-RULES.md §6: "Never call the production ZATCA
// environment from tests. Use the sandbox, and a mock adapter by default in CI"). Built on
// Node's built-in `fetch` — no new dependency needed.
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

export type HttpMethod = "POST" | "PATCH";

// What a real HTTP call needs; swappable for a mock in every test.
export interface HttpTransport {
  request(method: HttpMethod, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpResponse>;
}

export class FetchHttpTransport implements HttpTransport {
  async request(method: HttpMethod, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
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

// Any non-2xx is classified by status code, not swallowed into a generic failure — the caller
// needs to know whether a retry is ever worth attempting.
export function classifyErrorStatus(status: number, body: unknown): ZatcaApiError {
  if (status === 401 || status === 403) return new ZatcaApiError("AUTH_ERROR", `ZATCA authentication failed (HTTP ${String(status)})`, status, body);
  if (status === 429) return new ZatcaApiError("RATE_LIMITED", `ZATCA rate-limited the request (HTTP 429)`, status, body);
  if (status >= 500) return new ZatcaApiError("SERVER_ERROR", `ZATCA server error (HTTP ${String(status)})`, status, body);
  return new ZatcaApiError("CLIENT_ERROR", `ZATCA rejected the request (HTTP ${String(status)})`, status, body);
}

export const DEFAULT_ZATCA_TIMEOUT_MS = 20_000;
