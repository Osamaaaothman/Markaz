import { Money, CurrencyMismatchError } from "@erp/shared";
import { requiresApproval } from "./approval-policy.js";

describe("requiresApproval — B6 single-step threshold", () => {
  it("never requires approval when the company has no policy for this subject type", () => {
    expect(requiresApproval(Money.of("1000000", "SAR"), null)).toBe(false);
  });

  it("does not require approval exactly at the threshold — 'above' means strictly greater", () => {
    const policy = { thresholdAmount: "5000.00", currency: "SAR" };
    expect(requiresApproval(Money.of("5000.00", "SAR"), policy)).toBe(false);
  });

  it("requires approval for an amount above the threshold", () => {
    const policy = { thresholdAmount: "5000.00", currency: "SAR" };
    expect(requiresApproval(Money.of("5000.01", "SAR"), policy)).toBe(true);
  });

  it("does not require approval below the threshold", () => {
    const policy = { thresholdAmount: "5000.00", currency: "SAR" };
    expect(requiresApproval(Money.of("100", "SAR"), policy)).toBe(false);
  });

  it("throws rather than silently comparing across currencies", () => {
    const policy = { thresholdAmount: "5000.00", currency: "SAR" };
    expect(() => requiresApproval(Money.of("6000", "USD"), policy)).toThrow(CurrencyMismatchError);
  });
});
