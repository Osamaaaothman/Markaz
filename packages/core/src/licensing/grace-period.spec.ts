import { computeLicenseStatus } from "./grace-period.js";

describe("computeLicenseStatus", () => {
  const graceMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  it("returns UNCONFIGURED when no Activation Service is set up, regardless of time", () => {
    const status = computeLicenseStatus({
      now: new Date("2026-01-01T00:00:00Z"),
      configured: false,
      lastSuccessfulCheckinAt: null,
      graceMs,
    });
    expect(status).toBe("UNCONFIGURED");
  });

  it("returns GRACE when configured but never yet successfully checked in", () => {
    const status = computeLicenseStatus({
      now: new Date("2026-01-01T00:00:00Z"),
      configured: true,
      lastSuccessfulCheckinAt: null,
      graceMs,
    });
    expect(status).toBe("GRACE");
  });

  it("returns OK immediately after a successful check-in", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const status = computeLicenseStatus({
      now,
      configured: true,
      lastSuccessfulCheckinAt: now,
      graceMs,
    });
    expect(status).toBe("OK");
  });

  it("returns OK right up to the edge of the grace window", () => {
    const lastSuccessfulCheckinAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(lastSuccessfulCheckinAt.getTime() + graceMs);
    const status = computeLicenseStatus({ now, configured: true, lastSuccessfulCheckinAt, graceMs });
    expect(status).toBe("OK");
  });

  it("returns GRACE the moment the grace window is exceeded — never LOCKED from time alone", () => {
    const lastSuccessfulCheckinAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(lastSuccessfulCheckinAt.getTime() + graceMs + 1);
    const status = computeLicenseStatus({ now, configured: true, lastSuccessfulCheckinAt, graceMs });
    expect(status).toBe("GRACE");
  });

  it("returns GRACE (not OK) if the last successful check-in is implausibly far in the past", () => {
    const status = computeLicenseStatus({
      now: new Date("2026-06-01T00:00:00Z"),
      configured: true,
      lastSuccessfulCheckinAt: new Date("2020-01-01T00:00:00Z"),
      graceMs,
    });
    expect(status).toBe("GRACE");
  });
});
