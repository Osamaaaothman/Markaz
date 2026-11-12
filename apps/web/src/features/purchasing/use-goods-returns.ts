import { useQuery } from "@tanstack/react-query";
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

export function useGoodsReturn(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["goodsReturns", "detail", id],
    queryFn: async () => (await apiClient.get<GoodsReturnDetail>(`/v1/goods-returns/${id}`)).data,
    enabled: can("goods_return:read") && id !== "",
  });
}
