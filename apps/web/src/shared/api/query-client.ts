import { MutationCache, QueryClient } from "@tanstack/react-query";
import { successFeedback, type FeedbackMeta } from "../lib/feedback-policy";
import { useFeedbackStore } from "../lib/feedback-store";
import { isOfflineError } from "../offline/offline-error";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: FeedbackMeta;
  }
}

// docs/08-FRONTEND-I18N-RULES.md §2: "Sensible staleTime per data kind: reference
// data long, ledger data short." The per-query overrides live next to each
// feature's queries; this is just the sane global floor.
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (data, _variables, _context, mutation) => {
      const message = successFeedback(data, mutation.meta);
      if (message) useFeedbackStore.getState().notify(message);
    },
    onError: (error, _variables, _context, mutation) => {
      // An offline refusal is always worth saying, even for a mutation that reports its own errors.
      if (isOfflineError(error)) useFeedbackStore.getState().notify({ severity: "error", key: "offline.blocked" });
      else if (mutation.meta?.feedback !== "silent") useFeedbackStore.getState().notify({ severity: "error", key: "feedback.failed" });
    },
  }),
  defaultOptions: {
    // "always": a write must run (and be refused by the API client when offline) right now. The default
    // ("online") would silently PAUSE it and fire it later, on reconnect, which is exactly what must not
    // happen to financial changes (src/shared/offline/offline-error.ts).
    mutations: { networkMode: "always" },
    queries: {
      // Unused data is kept 24 h (not the 5 min default) so the saved offline copy keeps what was viewed
      // earlier; freshness online is still governed by staleTime below.
      gcTime: 24 * 60 * 60 * 1000,
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
