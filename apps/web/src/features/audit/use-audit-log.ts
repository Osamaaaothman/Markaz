import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface AuditReference {
  readonly entityType: string;
  readonly id: string;
  readonly number: string;
  readonly kind: string;
}
export interface AuditLogEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string;
  readonly document: AuditReference | null;
  readonly relatedDocuments: readonly AuditReference[];
}

export interface AuditFilter {
  readonly entityId: string;
  readonly entityType: string;
  readonly action: string;
  readonly actorId: string;
  readonly from: string;
  readonly to: string;
}

interface Page {
  readonly data: readonly AuditLogEntry[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useAuditLog(filter: AuditFilter) {
  const { can } = usePermissions();
  const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== ""));
  return useInfiniteQuery({
    queryKey: ["auditLog", filter],
    queryFn: async ({ pageParam }) => (await apiClient.get<Page>("/v1/audit-log", { params: { limit: "50", ...params, ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("audit_log:read"),
  });
}

export function useAuditFilters() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["auditLog", "filters"],
    queryFn: async () => (await apiClient.get<{ entityTypes: string[]; users: { id: string; email: string }[] }>("/v1/audit-log/filters")).data,
    staleTime: 60_000,
    enabled: can("audit_log:read"),
  });
}
