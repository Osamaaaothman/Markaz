import { newId } from "@erp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface StockIssueLineInput {
  readonly itemId: string;
  readonly quantity: string;
}

export interface CreateStockIssueInput {
  readonly warehouseId: string;
  readonly costCenterRef: string;
  readonly documentDate: string;
  readonly lines: readonly StockIssueLineInput[];
}

interface StockIssueResult {
  readonly id: string;
  readonly number: string;
}

export function useCreateStockIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStockIssueInput) => {
      const idempotencyKey = newId();
      return (
        await apiClient.post<StockIssueResult>("/v1/stock-issues", input, {
          headers: { "Idempotency-Key": idempotencyKey },
        })
      ).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
