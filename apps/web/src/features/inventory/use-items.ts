import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface ItemSummary {
  readonly id: string;
  readonly ref: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly unit: string;
  readonly reorderPoint: string;
  readonly isActive: boolean;
  // Id of the current picture (changes when it is replaced), or null.
  readonly pictureId: string | null;
}

interface ItemListPage {
  readonly data: readonly ItemSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface ItemFilter {
  readonly q: string;
  readonly includeInactive: boolean;
}

export interface CreateItemPayload {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly unit: string;
  readonly reorderPoint?: string;
}

export interface UpdateItemPayload {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly unit?: string;
  readonly reorderPoint?: string;
  readonly isActive?: boolean;
}

function listParams(filter: ItemFilter, cursor?: string): Record<string, string> {
  const q = filter.q.trim();
  return {
    limit: "50",
    ...(q ? { q } : {}),
    ...(filter.includeInactive ? { includeInactive: "true" } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function useItems(filter: ItemFilter) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["items", "list", filter],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<ItemListPage>("/v1/items", { params: listParams(filter, pageParam) })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: can("item:read"),
  });
}

// Every active item, for a document line's item picker.
export function useAllItems() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["items", "all"],
    queryFn: async () => (await apiClient.get<ItemListPage>("/v1/items", { params: { limit: "100" } })).data.data,
    staleTime: 60_000,
    enabled: can("item:read"),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateItemPayload) => (await apiClient.post<ItemSummary>("/v1/items", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useUpdateItem(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateItemPayload) => (await apiClient.patch<ItemSummary>(`/v1/items/${itemId}`, payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["items"] }),
  });
}
