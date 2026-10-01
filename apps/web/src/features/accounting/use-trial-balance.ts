import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface TrialBalanceLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly debitTotal: string;
  readonly creditTotal: string;
}

export interface TrialBalanceResult {
  readonly lines: readonly TrialBalanceLine[];
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly isBalanced: boolean;
}

// docs/05-ACCOUNTING-INTEGRITY-RULES.md §7: ledger data — a short staleTime, not
// the reference-data default (docs/08-FRONTEND-I18N-RULES.md §2).
export function useTrialBalance() {
  return useQuery({
    queryKey: ["trialBalance"],
    queryFn: async () => (await apiClient.get<TrialBalanceResult>("/v1/trial-balance")).data,
    staleTime: 10_000,
  });
}
