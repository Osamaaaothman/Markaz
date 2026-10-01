import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface BalanceSheetLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly balance: string;
}

export interface BalanceSheetSection {
  readonly lines: readonly BalanceSheetLine[];
  readonly total: string;
}

export interface BalanceSheetResult {
  readonly asOf: string;
  readonly assets: BalanceSheetSection;
  readonly liabilities: BalanceSheetSection;
  readonly equity: BalanceSheetSection;
  readonly currentYearEarnings: string;
  readonly totalEquity: string;
  readonly totalLiabilitiesAndEquity: string;
  readonly isBalanced: boolean;
}

// docs/05-ACCOUNTING-INTEGRITY-RULES.md §7-adjacent — ledger data, same short
// staleTime as the trial balance (docs/08-FRONTEND-I18N-RULES.md §2).
export function useBalanceSheet() {
  return useQuery({
    queryKey: ["balanceSheet"],
    queryFn: async () => (await apiClient.get<BalanceSheetResult>("/v1/balance-sheet")).data,
    staleTime: 10_000,
  });
}
