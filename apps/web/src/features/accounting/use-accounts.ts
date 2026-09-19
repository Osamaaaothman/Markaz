import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface AccountSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
}

// Reference data — long staleTime (docs/08-FRONTEND-I18N-RULES.md §2).
export function useAccounts() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await apiClient.get<AccountSummary[]>("/v1/accounts")).data,
    staleTime: 5 * 60_000,
    enabled: can("account:read"),
  });
}
