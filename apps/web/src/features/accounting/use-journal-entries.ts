import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface JournalEntrySummary {
  readonly id: string;
  readonly number: string;
  readonly entryDate: string;
  readonly currency: string;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly isReversal: boolean;
  readonly totalDebit: string;
}

interface JournalEntryListPage {
  readonly data: JournalEntrySummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface JournalEntriesFilter {
  readonly from?: string;
  readonly to?: string;
}

export function useJournalEntries(filter: JournalEntriesFilter = {}) {
  return useInfiniteQuery({
    queryKey: ["journalEntries", filter.from ?? "", filter.to ?? ""],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const params = {
        ...(pageParam !== null ? { cursor: pageParam } : {}),
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
      };
      return (await apiClient.get<JournalEntryListPage>("/v1/journal-entries", { params })).data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor,
    staleTime: 10_000,
  });
}
