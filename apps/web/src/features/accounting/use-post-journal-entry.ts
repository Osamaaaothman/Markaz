import { newId } from "@erp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface PostJournalEntryLine {
  readonly accountId: string;
  readonly debit?: string;
  readonly credit?: string;
  readonly description?: string;
}

export interface PostJournalEntryInput {
  readonly fiscalPeriodId: string;
  readonly entryDate: string;
  readonly postingDate: string;
  readonly currency: string;
  readonly lines: PostJournalEntryLine[];
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
}

interface PostingResult {
  readonly journalEntryId: string;
  readonly number: string;
}

export function usePostJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostJournalEntryInput) => {
      // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine
      // submission — generated once here, not per network retry, so a real
      // double-click still only posts once.
      const idempotencyKey = newId();
      return (
        await apiClient.post<PostingResult>("/v1/journal-entries", input, {
          headers: { "Idempotency-Key": idempotencyKey },
        })
      ).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["journalEntries"] });
      void queryClient.invalidateQueries({ queryKey: ["trialBalance"] });
      void queryClient.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
