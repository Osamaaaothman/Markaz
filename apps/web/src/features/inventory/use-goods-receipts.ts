import { newId } from "@erp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface GoodsReceiptLineInput {
  readonly itemId: string;
  readonly quantity: string;
  readonly unitCost: string;
}

export interface CreateGoodsReceiptInput {
  readonly warehouseId: string;
  readonly partyId?: string;
  readonly documentDate: string;
  readonly reference?: string;
  readonly lines: readonly GoodsReceiptLineInput[];
}

interface GoodsReceiptResult {
  readonly id: string;
  readonly number: string;
}

export function useCreateGoodsReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGoodsReceiptInput) => {
      // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
      const idempotencyKey = newId();
      return (
        await apiClient.post<GoodsReceiptResult>("/v1/goods-receipts", input, {
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
