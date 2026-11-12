import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface WarehouseSummary {
  readonly id: string;
  readonly ref: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly isActive: boolean;
}

interface WarehouseListPage {
  readonly data: readonly WarehouseSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface WarehouseFilter {
  readonly q: string;
  readonly includeInactive: boolean;
}

export interface CreateWarehousePayload {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string;
}

export interface UpdateWarehousePayload {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly isActive?: boolean;
}

function listParams(filter: WarehouseFilter, cursor?: string): Record<string, string> {
  const q = filter.q.trim();
  return {
    limit: "50",
    ...(q ? { q } : {}),
    ...(filter.includeInactive ? { includeInactive: "true" } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

// Server-side search and "load more" by cursor (docs/07 §6) — same shape as useParties.
export function useWarehouses(filter: WarehouseFilter) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["warehouses", "list", filter],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<WarehouseListPage>("/v1/warehouses", { params: listParams(filter, pageParam) })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: can("warehouse:read"),
  });
}

// Every active warehouse for document pickers, including warehouses beyond the first page.
export function useAllWarehouses() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: async () => {
      const warehouses: WarehouseSummary[] = [];
      let cursor: string | null = null;
      do {
        const page: WarehouseListPage = (await apiClient.get<WarehouseListPage>("/v1/warehouses", { params: { limit: "100", ...(cursor ? { cursor } : {}) } })).data;
        warehouses.push(...page.data);
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      } while (cursor);
      return warehouses;
    },
    staleTime: 60_000,
    enabled: can("warehouse:read"),
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: CreateWarehousePayload) =>
      (await apiClient.post<WarehouseSummary>("/v1/warehouses", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });
}

export function useUpdateWarehouse(warehouseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateWarehousePayload) =>
      (await apiClient.patch<WarehouseSummary>(`/v1/warehouses/${warehouseId}`, payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });
}
