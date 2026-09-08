// Pure, deterministic license-status computation — docs/10-TESTING-RULES.md §3:
// "no wall-clock dependence (inject the clock)". No I/O here; the network call and
// the DB read/write live in activation-client.ts and license-checkin.service.ts.
//
// Design per docs/adr/0002-drop-saas-single-purchase-per-customer-deployment.md and
// docs/01-OPEN-DECISIONS.md A5: a deployment must keep working through a temporary
// loss of contact with the Activation Service. LOCKED is intentionally NOT something
// this function ever computes from elapsed time alone — it is only ever set from an
// explicit rejection/revocation response from the Activation Service itself
// (see license-checkin.service.ts). Silently locking a live accounting system just
// because it went quiet for a while is the failure mode this whole design exists to
// avoid.
export type LicenseStatus = "OK" | "GRACE" | "LOCKED" | "UNCONFIGURED";

export interface LicenseStatusInput {
  readonly now: Date;
  readonly configured: boolean;
  readonly lastSuccessfulCheckinAt: Date | null;
  readonly graceMs: number;
}

export function computeLicenseStatus(input: LicenseStatusInput): LicenseStatus {
  if (!input.configured) {
    return "UNCONFIGURED";
  }
  if (input.lastSuccessfulCheckinAt === null) {
    // Never yet confirmed — e.g. between install and the first successful check-in.
    // Treated as within grace, not locked, until proven otherwise.
    return "GRACE";
  }
  const elapsedMs = input.now.getTime() - input.lastSuccessfulCheckinAt.getTime();
  if (elapsedMs <= input.graceMs) {
    return "OK";
  }
  return "GRACE";
}

// Defaults per the ADR's proposal — exact numbers are still open
// (docs/01-OPEN-DECISIONS.md A5), adjust here when Osama confirms them.
export const DEFAULT_CHECKIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly
export const DEFAULT_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
