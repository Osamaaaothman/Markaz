import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// The party (person, company, employee...) an account is kept for — name and kind only.
export interface AccountPartyRef {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
}

export interface ChartOfAccountEntry {
  readonly id: string;
  readonly ref: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
  // A stopped account keeps its history but takes no new postings. Only the chart screen and report labels see them.
  readonly isActive: boolean;
  readonly parentId: string | null;
  readonly partyId: string | null;
  // #RRGGBB, set on top-level accounts only.
  readonly color: string | null;
  readonly party: AccountPartyRef | null;
}

export interface CreateAccountPayload {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  readonly isPostable: boolean;
  readonly parentId: string | null;
  readonly partyId?: string;
  readonly color?: string;
}

// null clears nameAr, the party link or the colour; a field left out is kept.
export interface UpdateAccountPayload {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly partyId?: string | null;
  readonly color?: string | null;
}

// Reference data — long staleTime (docs/08-FRONTEND-I18N-RULES.md §2), same as
// the account picker list this pairs with.
// Pickers use the default (active accounts only). The chart screen and the report labels pass includeInactive, so a
// stopped account is still shown and named.
export function useChartOfAccounts(includeInactive = false) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["chartOfAccounts", { includeInactive }],
    queryFn: async () =>
      (await apiClient.get<ChartOfAccountEntry[]>("/v1/chart-of-accounts", { params: includeInactive ? { includeInactive: "true" } : {} })).data,
    staleTime: 5 * 60_000,
    // Also read by the report pages (via use-account-label) only to show Arabic names, so a
    // user without account:read simply sees English names instead of a failed request.
    enabled: can("account:read"),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: (payload: CreateAccountPayload) =>
      apiClient.post<ChartOfAccountEntry>("/v1/accounts", payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] }),
  });
}

export function useUpdateAccount(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateAccountPayload) =>
      apiClient.patch<ChartOfAccountEntry>(`/v1/accounts/${accountId}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
      // Journal pickers show account names too.
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export interface AccountUsage {
  readonly ledgerLines: number;
  readonly mappings: number;
  readonly supplierInvoiceLines: number;
  readonly salesInvoiceLines: number;
  readonly payments: number;
  readonly salaryAdvances: number;
  readonly salaryAdvanceRepayments: number;
  readonly employeeAccounts: number;
  readonly children: number;
  readonly linkedParty: boolean;
}

export interface AccountUsageResult {
  readonly id: string;
  readonly code: string;
  readonly usage: AccountUsage;
  readonly canDelete: boolean;
}

// What points at an account, to say why it cannot be deleted. Fetched only while the edit dialog is open.
export function useAccountUsage(accountId: string | null) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["accountUsage", accountId],
    queryFn: async () => (await apiClient.get<AccountUsageResult>(`/v1/accounts/${accountId}/usage`)).data,
    enabled: accountId !== null && can("account:read"),
    staleTime: 0,
  });
}

export function useDeleteAccount(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { successKey: "feedback.deleted" },
    mutationFn: async () => {
      await apiClient.delete(`/v1/accounts/${accountId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

// Stops (false) or restarts (true) an account. Stopping one that still has a balance needs acknowledgeBalance.
export function useSetAccountActive(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly isActive: boolean; readonly acknowledgeBalance?: boolean }) =>
      (await apiClient.patch<ChartOfAccountEntry>(`/v1/accounts/${accountId}/active`, input)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// Turns an account nothing has used yet into a folder that can hold other accounts. A used account is refused (409).
export function useMakeAccountGroup(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<ChartOfAccountEntry>(`/v1/accounts/${accountId}/make-group`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// Moves an account, with everything under it, to another group of the same type (null = the top level).
export function useMoveAccount(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (parentId: string | null) => (await apiClient.patch<ChartOfAccountEntry>(`/v1/accounts/${accountId}/parent`, { parentId })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
