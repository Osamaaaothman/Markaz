import { create } from "zustand";
import type { AuthUser } from "@erp/shared";
import { login as apiLogin, logout as apiLogout, refreshTokens } from "../lib/api";

const REFRESH_TOKEN_KEY = "refreshToken";

type AuthStatus = "idle" | "authenticating" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  accessToken: string | null;
  /** Tries to resume a session from the persisted refresh token on boot. */
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "idle",
  user: null,
  accessToken: null,

  hydrate: async () => {
    const storedRefreshToken = await window.api.secureStorage.get(REFRESH_TOKEN_KEY);
    if (!storedRefreshToken) {
      set({ status: "unauthenticated" });
      return;
    }

    try {
      const result = await refreshTokens(storedRefreshToken);
      await window.api.secureStorage.set(REFRESH_TOKEN_KEY, result.refreshToken);
      set({ status: "authenticated", user: result.user, accessToken: result.accessToken });
    } catch {
      await window.api.secureStorage.delete(REFRESH_TOKEN_KEY);
      set({ status: "unauthenticated" });
    }
  },

  login: async (email, password) => {
    set({ status: "authenticating" });
    try {
      const result = await apiLogin({ email, password });
      await window.api.secureStorage.set(REFRESH_TOKEN_KEY, result.refreshToken);
      set({ status: "authenticated", user: result.user, accessToken: result.accessToken });
    } catch (error) {
      set({ status: "unauthenticated" });
      throw error;
    }
  },

  logout: async () => {
    const storedRefreshToken = await window.api.secureStorage.get(REFRESH_TOKEN_KEY);
    await window.api.secureStorage.delete(REFRESH_TOKEN_KEY);
    set({ status: "unauthenticated", user: null, accessToken: null });
    if (storedRefreshToken) {
      // Best-effort -- the local session is already cleared either way.
      apiLogout(storedRefreshToken).catch(() => {});
    }
  },
}));
