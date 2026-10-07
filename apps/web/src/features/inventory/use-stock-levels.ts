import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface StockLevelEntry {
  readonly itemId: string;
  readonly itemRef: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly quantity: string;
  readonly value: string;
  readonly averageUnitCost: string;
  readonly reorderPoint: string;
  readonly belowReorderPoint: boolean;
}

export interface StockLevelFilter {
  readonly warehouseId: string | null;
  readonly belowReorderOnly: boolean;
}

export function useStockLevels(filter: StockLevelFilter) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["stockLevels", filter],
    queryFn: async () =>
      (
        await apiClient.get<StockLevelEntry[]>("/v1/stock-levels", {
          params: {
            ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
            ...(filter.belowReorderOnly ? { belowReorderOnly: "true" } : {}),
          },
        })
      ).data,
    staleTime: 15_000,
    enabled: can("stock:read"),
  });
}
