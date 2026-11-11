import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../auth/auth-store";
import { createSessionRefresher } from "../auth/refresh-session";
import { tokenPrincipal } from "../auth/token-principal";

// Same-origin /api/... in both dev (vite.config.ts proxy) and production
// (docker/web.nginx.conf) — the frontend never needs to know the API's real
// address, and the API never needs CORS configuration.
export const apiClient = axios.create({ baseURL: "/api" });

// A bare instance for the refresh call itself — must NOT go through the
// response interceptor below, or a failed refresh would recursively try to
// refresh again.
const refreshClient = axios.create({ baseURL: "/api" });

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token !== null) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// Refresh token rotation (docs/09-SECURITY-RULES.md §2) — at most ONE retry per
// request, and concurrent 401s share a single in-flight refresh instead of each
// firing its own (which would trip the server's reuse-detection and log
// everyone out).
const refreshSession = createSessionRefresher({
  synchronize: async () => { await useAuthStore.persist.rehydrate(); },
  accessToken: () => useAuthStore.getState().accessToken,
  refresh: refreshAccessToken,
  sameUser: (previous, current) => tokenPrincipal(previous) !== null && tokenPrincipal(previous) === tokenPrincipal(current),
  lock: async (work) => typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request("erp-auth-refresh", work)
    : work(),
});

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (refreshToken === null) {
    return null;
  }
  try {
    const response = await refreshClient.post<{ accessToken: string; refreshToken: string }>(
      "/v1/auth/refresh",
      { refreshToken },
    );
    await useAuthStore.persist.rehydrate();
    // A logout/login while the request was in flight must not resurrect the old session.
    if (useAuthStore.getState().refreshToken !== refreshToken) return null;
    useAuthStore.getState().setTokens(response.data);
    return response.data.accessToken;
  } catch {
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    if (error.response?.status === 401 && original !== undefined && !original._retried) {
      original._retried = true;
      const header = original.headers.get("Authorization");
      const failedToken = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;
      const { token: newToken, clear } = await refreshSession(failedToken);
      if (newToken !== null) {
        original.headers.set("Authorization", `Bearer ${newToken}`);
        return apiClient(original);
      }
      if (clear) useAuthStore.getState().clear();
    }
    return Promise.reject(error);
  },
);
