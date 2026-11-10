import { MutationCache, QueryClient } from "@tanstack/react-query";
import { successFeedback, type FeedbackMeta } from "../lib/feedback-policy";
import { useFeedbackStore } from "../lib/feedback-store";

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
    onError: (_error, _variables, _context, mutation) => {
      if (mutation.meta?.feedback !== "silent") useFeedbackStore.getState().notify({ severity: "error", key: "feedback.failed" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
