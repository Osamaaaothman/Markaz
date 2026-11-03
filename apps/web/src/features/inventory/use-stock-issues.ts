import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

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
      void qc.invalidateQueries({ queryKey: ["stockIssues"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

export interface StockIssueSummary {
  readonly id: string;
  readonly number: string;
  readonly documentDate: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseNameAr: string | null;
  readonly costCenterRef: string;
  readonly lineCount: number;
  readonly totalValue: string;
}

export interface StockIssueLineDetail {
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

export interface StockIssueDetail extends StockIssueSummary {
  readonly currency: string;
  readonly journalEntryId: string;
  readonly lines: readonly StockIssueLineDetail[];
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useStockIssues() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["stockIssues", "list"],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<StockIssueSummary>>("/v1/stock-issues", { params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("stock_issue:read"),
  });
}

export function useStockIssue(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["stockIssues", "detail", id],
    queryFn: async () => (await apiClient.get<StockIssueDetail>(`/v1/stock-issues/${id}`)).data,
    enabled: can("stock_issue:read") && id !== "",
  });
}
