import { QueryClient } from "@tanstack/react-query";

// docs/08-FRONTEND-I18N-RULES.md §2: "Sensible staleTime per data kind: reference
// data long, ledger data short." The per-query overrides live next to each
// feature's queries; this is just the sane global floor.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
