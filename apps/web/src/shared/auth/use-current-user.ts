import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useAuthStore } from "./auth-store";

export interface CurrentUserProfile {
  readonly id: string;
  readonly email: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyDefaultCurrency: string;
  readonly permissions: string[];
}

// Server data — TanStack Query, never the Zustand auth store
// (docs/08-FRONTEND-I18N-RULES.md §2).
export function useCurrentUser() {
  const accessToken = useAuthStore((state) => state.accessToken);
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => (await apiClient.get<CurrentUserProfile>("/v1/users/me")).data,
    enabled: accessToken !== null,
    staleTime: 5 * 60_000,
  });
}
