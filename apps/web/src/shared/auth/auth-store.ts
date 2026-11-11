import { create } from "zustand";
import { persist } from "zustand/middleware";
import { queryClient } from "../api/query-client";
import { tokenPrincipal } from "./token-principal";

// docs/08-FRONTEND-I18N-RULES.md §2: "Server data never goes into Zustand" — this
// store deliberately holds ONLY the token pair and login/logout actions, never
// the user's profile (that's server data, fetched via TanStack Query in
// shared/auth/use-current-user.ts).
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  clear: () => void;
}

// Persisted to localStorage — the API (M1) returns tokens in the response body,
// not a cookie, so the SPA has to hold them somewhere JS can read; this is the
// standard tradeoff for that API shape, not a separate security decision this
// store is making on its own.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      // Logging out (or losing the session) must also drop every cached server response:
      // the profile and permissions of the previous user would otherwise still be served
      // to whoever signs in next, until the cache happened to expire.
      clear: () => {
        set({ accessToken: null, refreshToken: null });
        queryClient.clear();
      },
    }),
    { name: "erp-auth" },
  ),
);

// Other tabs must see rotations and logout before they attempt their own refresh.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== "erp-auth" && event.key !== null) return;
    const previous = tokenPrincipal(useAuthStore.getState().accessToken);
    void Promise.resolve(useAuthStore.persist.rehydrate()).then(() => {
      // Cached user/profile data may belong to a different login in the other tab.
      if (previous !== tokenPrincipal(useAuthStore.getState().accessToken)) queryClient.clear();
    });
  });
}
