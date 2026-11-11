import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface CashExpenseSummary {
  readonly id: string;
  readonly number: string;
  readonly expenseDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly expenseAccountCode: string;
  readonly expenseAccountName: string;
  readonly expenseAccountNameAr: string | null;
  readonly description: string | null;
  readonly reference: string | null;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useCashExpenses() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["cashExpenses", "list"],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<CashExpenseSummary>>("/v1/cash-expenses", { params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("cash_expense:read"),
  });
}

export interface CreateCashExpensePayload {
  readonly expenseDate: string;
  readonly amount: string;
  readonly cashAccountId: string;
  readonly expenseAccountId: string;
  readonly description?: string;
  readonly reference?: string;
}

export function useCreateCashExpense(submissionKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: CreateCashExpensePayload) =>
      (
        await apiClient.post<{ id: string; number: string; journalEntryId: string }>("/v1/cash-expenses", payload, {
          headers: { "Idempotency-Key": submissionKey ?? newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cashExpenses"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
