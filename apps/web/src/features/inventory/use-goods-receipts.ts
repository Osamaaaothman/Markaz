import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

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

export function useCreateGoodsReceipt(submissionKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (input: CreateGoodsReceiptInput) => {
      // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
      const idempotencyKey = submissionKey ?? newId();
      return (
        await apiClient.post<GoodsReceiptResult>("/v1/goods-receipts", input, {
          headers: { "Idempotency-Key": idempotencyKey },
        })
      ).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goodsReceipts"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

export interface GoodsReceiptSummary {
  readonly id: string;
  readonly number: string;
  readonly documentDate: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly partyId: string | null;
  readonly partyName: string | null;
  readonly partyNameAr: string | null;
  readonly purchaseOrderId: string | null;
  readonly purchaseOrderNumber: string | null;
  readonly reference: string | null;
  readonly lineCount: number;
  readonly totalValue: string;
}

export interface GoodsReceiptLineDetail {
  readonly lineNumber: number;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly unit: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly value: string;
}

export interface GoodsReceiptDetail extends GoodsReceiptSummary {
  readonly currency: string;
  readonly journalEntryId: string;
  readonly lines: readonly GoodsReceiptLineDetail[];
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useGoodsReceipts() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["goodsReceipts", "list"],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<GoodsReceiptSummary>>("/v1/goods-receipts", { params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("goods_receipt:read"),
  });
}

export function useGoodsReceipt(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["goodsReceipts", "detail", id],
    queryFn: async () => (await apiClient.get<GoodsReceiptDetail>(`/v1/goods-receipts/${id}`)).data,
    enabled: can("goods_receipt:read") && id !== "",
  });
}
