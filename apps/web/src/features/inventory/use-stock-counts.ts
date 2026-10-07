import { newId } from "@erp/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface StockCountLineInput {
  readonly itemId: string;
  readonly countedQuantity: string;
  readonly unitCostIfNoStock?: string;
}

export interface RecordStockCountInput {
  readonly warehouseId: string;
  readonly documentDate: string;
  readonly lines: readonly StockCountLineInput[];
}

export interface StockCountSummary {
  readonly id: string;
  readonly number: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly documentDate: string;
  readonly isPosted: boolean;
  readonly lineCount: number;
}

export function useStockCounts(unpostedOnly: boolean) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["stockCounts", { unpostedOnly }],
    queryFn: async () =>
      (
        await apiClient.get<StockCountSummary[]>("/v1/stock-counts", {
          params: unpostedOnly ? { unpostedOnly: "true" } : {},
        })
      ).data,
    staleTime: 15_000,
    enabled: can("stock_count:read"),
  });
}

export function useRecordStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordStockCountInput) =>
      (await apiClient.post<{ id: string; number: string }>("/v1/stock-counts", input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stockCounts"] }),
  });
}

export function usePostStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (countId: string) => {
      const idempotencyKey = newId();
      return (
        await apiClient.post<{ id: string; journalEntryId: string | null }>(
          `/v1/stock-counts/${countId}/post`,
          {},
          { headers: { "Idempotency-Key": idempotencyKey } },
        )
      ).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stockCounts"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
