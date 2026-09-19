import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// Amounts are decimal strings computed on the server (docs/08-FRONTEND-I18N-RULES.md §6) —
// the UI only formats them, never adds them up. Parents already carry the sum of their children.
export interface AccountBalance {
  readonly accountId: string;
  readonly debitTotal: string;
  readonly creditTotal: string;
  readonly balance: string;
  readonly balanceSide: "DEBIT" | "CREDIT" | null;
}

// Ledger totals need trial_balance:read (the API enforces it too). Kept apart from the chart
// structure so the tree stays cached for minutes while totals refresh quickly after a posting.
export function useAccountBalances() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["accountBalances"],
    queryFn: async () => (await apiClient.get<AccountBalance[]>("/v1/chart-of-accounts/balances")).data,
    staleTime: 30_000,
    enabled: can("trial_balance:read"),
  });
}
