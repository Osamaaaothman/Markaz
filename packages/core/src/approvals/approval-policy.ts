import { Money } from "@erp/shared";

// docs/01-OPEN-DECISIONS.md B6: "Single-step amount threshold, or full multi-step
// configurable engine? Tier 1 assumes the simpler version." This IS that simpler
// version — one threshold per (company, subject type), nothing multi-step. A
// company with no policy row for a subject type never requires approval for it;
// approval is opt-in per document type, not a default a company has to turn off.
export interface ApprovalPolicyConfig {
  readonly thresholdAmount: string;
  readonly currency: string;
}

export function requiresApproval(amount: Money, policy: ApprovalPolicyConfig | null): boolean {
  if (policy === null) {
    return false;
  }
  const threshold = Money.of(policy.thresholdAmount, policy.currency);
  return amount.compareTo(threshold) > 0;
}
