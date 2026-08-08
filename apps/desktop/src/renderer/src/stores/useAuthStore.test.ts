import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@erp/shared";
import { useAuthStore } from "./useAuthStore";
import * as api from "../lib/api";

vi.mock("../lib/api", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refreshTokens: vi.fn(),
}));

const mockUser: AuthUser = { id: "u1", email: "admin@markaz.local", name: "Admin", role: "Admin" };

const secureStorageGet = vi.fn<(key: string) => Promise<string | null>>();
const secureStorageSet = vi.fn<(key: string, value: string) => Promise<boolean>>();
const secureStorageDelete = vi.fn<(key: string) => Promise<boolean>>();

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: "idle", user: null, accessToken: null });
  secureStorageGet.mockResolvedValue(null);
  secureStorageSet.mockResolvedValue(true);
  secureStorageDelete.mockResolvedValue(true);
  window.api = {
    secureStorage: {
      get: secureStorageGet,
      set: secureStorageSet,
      delete: secureStorageDelete,
    },
  };
});

describe("useAuthStore", () => {
  describe("hydrate", () => {
    it("goes unauthenticated when there's no stored refresh token", async () => {
      await useAuthStore.getState().hydrate();

      expect(useAuthStore.getState().status).toBe("unauthenticated");
    });

    it("resumes a session when the stored refresh token is still valid", async () => {
      secureStorageGet.mockResolvedValue("stored-refresh-token");
      vi.mocked(api.refreshTokens).mockResolvedValue({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        user: mockUser,
      });

      await useAuthStore.getState().hydrate();

      const state = useAuthStore.getState();
      expect(state.status).toBe("authenticated");
      expect(state.user).toEqual(mockUser);
      expect(state.accessToken).toBe("new-access");
      expect(secureStorageSet).toHaveBeenCalledWith("refreshToken", "new-refresh");
    });

    it("clears storage and goes unauthenticated when the refresh fails", async () => {
      secureStorageGet.mockResolvedValue("stale-token");
      vi.mocked(api.refreshTokens).mockRejectedValue(new Error("expired"));

      await useAuthStore.getState().hydrate();

      expect(useAuthStore.getState().status).toBe("unauthenticated");
      expect(secureStorageDelete).toHaveBeenCalledWith("refreshToken");
    });
  });

  describe("login", () => {
    it("authenticates and persists the refresh token on success", async () => {
      vi.mocked(api.login).mockResolvedValue({
        accessToken: "access",
        refreshToken: "refresh",
        user: mockUser,
      });

      await useAuthStore.getState().login(mockUser.email, "correct-password");

      const state = useAuthStore.getState();
      expect(state.status).toBe("authenticated");
      expect(state.accessToken).toBe("access");
      expect(secureStorageSet).toHaveBeenCalledWith("refreshToken", "refresh");
    });

    it("goes unauthenticated and rethrows on failure", async () => {
      vi.mocked(api.login).mockRejectedValue(new Error("bad credentials"));

      await expect(useAuthStore.getState().login(mockUser.email, "wrong")).rejects.toThrow();
      expect(useAuthStore.getState().status).toBe("unauthenticated");
    });
  });

  describe("logout", () => {
    it("clears local state and storage, and revokes the token best-effort", async () => {
      useAuthStore.setState({ status: "authenticated", user: mockUser, accessToken: "access" });
      secureStorageGet.mockResolvedValue("refresh-token");
      vi.mocked(api.logout).mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.status).toBe("unauthenticated");
      expect(state.user).toBeNull();
      expect(secureStorageDelete).toHaveBeenCalledWith("refreshToken");
      expect(api.logout).toHaveBeenCalledWith("refresh-token");
    });
  });
});
