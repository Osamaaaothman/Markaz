import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface TrialBalanceLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly movementDebit: string;
  readonly movementCredit: string;
  readonly closingDebit: string;
  readonly closingCredit: string;
}

export interface TrialBalanceTotals {
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly movementDebit: string;
  readonly movementCredit: string;
  readonly closingDebit: string;
  readonly closingCredit: string;
}

export interface TrialBalanceResult {
  readonly from: string;
  readonly to: string;
  readonly lines: readonly TrialBalanceLine[];
  readonly totals: TrialBalanceTotals;
  readonly isBalanced: boolean;
}

// docs/05-ACCOUNTING-INTEGRITY-RULES.md section 7: ledger data, so a short staleTime, not the reference-data default
// (docs/08-FRONTEND-I18N-RULES.md section 2). The period is part of the key: another period is another report.
export function useTrialBalance(from: string, to: string) {
  return useQuery({
    queryKey: ["trialBalance", from, to],
    queryFn: async () => (await apiClient.get<TrialBalanceResult>("/v1/trial-balance/period", { params: { from, to } })).data,
    staleTime: 10_000,
  });
}
