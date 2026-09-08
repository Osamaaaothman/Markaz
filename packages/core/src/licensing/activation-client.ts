// HTTP client for the central Activation Service — docs/00-PRODUCT-BRIEF.md §8.
// This deployment's master key authenticates it; the Activation Service is Osama's
// own separate infrastructure and is never called from inside a DB transaction
// (docs/02-ARCHITECTURE-RULES.md §5 — never an external HTTP call inside one).
export interface ActivationCheckinResult {
  readonly outcome: "SUCCESS" | "UNREACHABLE" | "REJECTED";
  readonly seatsAllowed?: number;
  readonly seatsUsed?: number;
}

export interface ActivationClientConfig {
  readonly serviceUrl: string | undefined;
  readonly masterKey: string | undefined;
  readonly timeoutMs?: number;
}

export class ActivationServiceClient {
  constructor(private readonly config: ActivationClientConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.serviceUrl && this.config.masterKey);
  }

  async checkin(seatsUsed: number): Promise<ActivationCheckinResult> {
    if (!this.isConfigured()) {
      return { outcome: "UNREACHABLE" };
    }

    try {
      const response = await fetch(`${this.config.serviceUrl}/v1/checkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.masterKey}`,
        },
        body: JSON.stringify({ seatsUsed }),
        // docs/07-API-RULES.md §9 / docs/02 §6: never an unbounded wait on an
        // external call.
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });

      if (response.status === 403 || response.status === 410) {
        return { outcome: "REJECTED" };
      }
      if (!response.ok) {
        return { outcome: "UNREACHABLE" };
      }

      const body = (await response.json()) as { seatsAllowed?: number; seatsUsed?: number };
      return {
        outcome: "SUCCESS",
        ...(body.seatsAllowed !== undefined ? { seatsAllowed: body.seatsAllowed } : {}),
        ...(body.seatsUsed !== undefined ? { seatsUsed: body.seatsUsed } : {}),
      };
    } catch {
      // Network error, timeout, DNS failure — all treated as UNREACHABLE, never as
      // a rejection. Only an explicit 403/410 from the server counts as REJECTED.
      return { outcome: "UNREACHABLE" };
    }
  }
}
