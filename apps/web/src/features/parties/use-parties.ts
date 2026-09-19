import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export const PARTY_KINDS = ["COMPANY", "PERSON", "EMPLOYEE", "OTHER"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export interface PartySummary {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly kind: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isActive: boolean;
}

interface PartyListPage {
  readonly data: readonly PartySummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface PartyFilter {
  readonly q: string;
  readonly kind: PartyKind | null;
  readonly includeInactive: boolean;
}

export interface CreatePartyPayload {
  readonly name: string;
  readonly nameAr?: string;
  readonly kind: PartyKind;
  readonly phone?: string;
  readonly email?: string;
}

// null clears an optional detail; a field left out is kept.
export interface UpdatePartyPayload {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly kind?: PartyKind;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly isActive?: boolean;
}

function listParams(filter: PartyFilter, cursor?: string): Record<string, string> {
  const q = filter.q.trim();
  return {
    limit: "50",
    ...(q ? { q } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.includeInactive ? { includeInactive: "true" } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

// The Parties screen: server-side search and filter, "load more" by cursor (docs/07 §6).
export function useParties(filter: PartyFilter) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["parties", "list", filter],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<PartyListPage>("/v1/parties", {
          params: listParams(filter, pageParam),
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: can("party:read"),
  });
}

// The party picker on account forms: the first page of matches for what the user typed.
export function usePartySearch(q: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["parties", "search", q.trim()],
    queryFn: async () =>
      (
        await apiClient.get<PartyListPage>("/v1/parties", {
          params: listParams({ q, kind: null, includeInactive: false }),
        })
      ).data.data,
    staleTime: 30_000,
    enabled: can("party:read"),
  });
}

export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePartyPayload) => (await apiClient.post<PartySummary>("/v1/parties", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["parties"] }),
  });
}

export function useUpdateParty(partyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdatePartyPayload) =>
      (await apiClient.patch<PartySummary>(`/v1/parties/${partyId}`, payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parties"] });
      // The chart shows each linked account's party name.
      void qc.invalidateQueries({ queryKey: ["chartOfAccounts"] });
    },
  });
}
