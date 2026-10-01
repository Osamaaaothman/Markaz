import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { queryClient } from "../../shared/api/query-client";
import { useAuthStore } from "../../shared/auth/auth-store";

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export function useLogin() {
  const setTokens = useAuthStore((state) => state.setTokens);
  return useMutation({
    mutationFn: async (input: LoginInput) => (await apiClient.post<TokenPair>("/v1/auth/login", input)).data,
    // Also cleared here, not only on logout: signing in again on /login without logging
    // out first would otherwise keep the previous user's cached profile and permissions.
    onSuccess: (tokens) => {
      queryClient.clear();
      setTokens(tokens);
    },
  });
}
