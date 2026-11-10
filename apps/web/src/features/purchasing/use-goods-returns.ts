import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface GoodsReturnLine {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly quantity: string;
  readonly unitCost: string;
  readonly value: string;
}

export interface GoodsReturnSummary {
  readonly id: string;
  readonly number: string;
  readonly documentDate: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderNumber: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly currency: string;
  readonly totalValue: string;
  readonly lines: readonly GoodsReturnLine[];
}

export interface GoodsReturnDetail extends GoodsReturnSummary {
  readonly journalEntryId: string;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useGoodsReturns() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["goodsReturns", "list"],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<GoodsReturnSummary>>("/v1/goods-returns", { params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("goods_return:read"),
  });
}

export function useGoodsReturn(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["goodsReturns", "detail", id],
    queryFn: async () => (await apiClient.get<GoodsReturnDetail>(`/v1/goods-returns/${id}`)).data,
    enabled: can("goods_return:read") && id !== "",
  });
}

export interface ReturnGoodsPayload {
  readonly purchaseOrderId: string;
  readonly warehouseId: string;
  readonly documentDate: string;
  readonly reference?: string;
  readonly reason?: string;
  readonly lines: readonly { readonly purchaseOrderLineId: string; readonly quantity: string }[];
}

export function useReturnGoods() {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: ReturnGoodsPayload) =>
      (
        await apiClient.post<{ id: string; number: string; orderStatus: string }>("/v1/goods-returns", payload, {
          // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
          headers: { "Idempotency-Key": newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goodsReturns"] });
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
