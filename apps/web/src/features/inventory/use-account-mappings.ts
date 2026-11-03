import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export const ACCOUNT_MAPPING_KEYS = [
  "INVENTORY",
  "GRNI",
  "PROJECT_ISSUE_EXPENSE",
  "COUNT_LOSS",
  "COUNT_GAIN",
  "ACCOUNTS_PAYABLE",
  "VAT_INPUT",
  "PURCHASE_PRICE_VARIANCE",
  "ACCOUNTS_RECEIVABLE",
  "SALES_REVENUE",
  "VAT_OUTPUT",
  "COST_OF_GOODS_SOLD",
  "SALARY_EXPENSE",
  "GOSI_EMPLOYER_EXPENSE",
  "GOSI_PAYABLE",
  "NET_PAY_PAYABLE",
  "SALARY_ADVANCES_RECEIVABLE",
  "EOSB_EXPENSE",
  "EOSB_PAYABLE",
  "EMPLOYEE_ADVANCES_PARENT",
  "EMPLOYEE_SALARY_PAYABLE_PARENT",
  "EMPLOYEE_EOSB_PARENT",
] as const;
export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

// Keys that map a group (folder) account, with the type it must have; every other key maps a postable account.
export const GROUP_MAPPING_KEYS: Readonly<Partial<Record<AccountMappingKey, "ASSET" | "LIABILITY">>> = {
  EMPLOYEE_ADVANCES_PARENT: "ASSET",
  EMPLOYEE_SALARY_PAYABLE_PARENT: "LIABILITY",
  EMPLOYEE_EOSB_PARENT: "LIABILITY",
};

export interface AccountMappingEntry {
  readonly key: AccountMappingKey;
  readonly accountId: string | null;
  readonly accountCode: string | null;
  readonly accountName: string | null;
}

export function useAccountMappings() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["accountMappings"],
    queryFn: async () => (await apiClient.get<AccountMappingEntry[]>("/v1/account-mappings")).data,
    staleTime: 30_000,
    enabled: can("account_mapping:read"),
  });
}

export function useSetAccountMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, accountId }: { key: AccountMappingKey; accountId: string }) =>
      (await apiClient.put<AccountMappingEntry>(`/v1/account-mappings/${key}`, { accountId })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["accountMappings"] }),
  });
}
