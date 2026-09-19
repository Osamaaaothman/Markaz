import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface ChartOfAccountEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
  readonly parentId: string | null;
}

export interface CreateAccountPayload {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  readonly isPostable: boolean;
  readonly parentId: string | null;
}

// Reference data — long staleTime (docs/08-FRONTEND-I18N-RULES.md §2), same as
// the account picker list this pairs with.
export function useChartOfAccounts() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["chartOfAccounts"],
    queryFn: async () => (await apiClient.get<ChartOfAccountEntry[]>("/v1/chart-of-accounts")).data,
    staleTime: 5 * 60_000,
    // Also read by the report pages (via use-account-label) only to show Arabic names, so a
    // user without account:read simply sees English names instead of a failed request.
    enabled: can("account:read"),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAccountPayload) =>
      apiClient.post<ChartOfAccountEntry>("/v1/accounts", payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] }),
  });
}
