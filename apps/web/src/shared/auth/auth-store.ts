import { create } from "zustand";
import { persist } from "zustand/middleware";

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
      clear: () => set({ accessToken: null, refreshToken: null }),
    }),
    { name: "erp-auth" },
  ),
);
