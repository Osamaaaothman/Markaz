import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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

export interface JournalEntryLineDetail {
  readonly id: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly debit: string;
  readonly credit: string;
  readonly description: string | null;
}

export interface JournalEntryDetail {
  readonly id: string;
  readonly number: string;
  readonly entryDate: string;
  readonly postingDate: string;
  readonly currency: string;
  readonly exchangeRate: string | null;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly isReversal: boolean;
  readonly reversalOfEntryNumber: string | null;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly lines: readonly JournalEntryLineDetail[];
}

export function useJournalEntry(id: string | null) {
  return useQuery({
    queryKey: ["journalEntry", id],
    queryFn: async () => (await apiClient.get<JournalEntryDetail>(`/v1/journal-entries/${id}`)).data,
    enabled: id !== null,
  });
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
