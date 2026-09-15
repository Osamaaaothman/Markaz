import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface ChartOfAccountEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly isPostable: boolean;
  readonly parentId: string | null;
}

// Reference data — long staleTime (docs/08-FRONTEND-I18N-RULES.md §2), same as
// the account picker list this pairs with.
export function useChartOfAccounts() {
  return useQuery({
    queryKey: ["chartOfAccounts"],
    queryFn: async () => (await apiClient.get<ChartOfAccountEntry[]>("/v1/chart-of-accounts")).data,
    staleTime: 5 * 60_000,
  });
}
