import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface LedgerStatementLine {
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
}

export interface LedgerStatement {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly normalBalance: "DEBIT" | "CREDIT";
  readonly from: string;
  readonly to: string;
  readonly openingBalance: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly closingBalance: string;
  readonly lines: readonly LedgerStatementLine[];
  readonly truncated: boolean;
}

// Ledger data — short staleTime like the other reports. Disabled until an account is chosen.
export function useLedger(accountId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["ledger", accountId, from, to],
    queryFn: async () =>
      (await apiClient.get<LedgerStatement>("/v1/ledger", { params: { accountId, from, to } })).data,
    enabled: accountId.length > 0 && from.length > 0 && to.length > 0,
    staleTime: 10_000,
  });
}
