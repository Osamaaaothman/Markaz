import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
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
    onSuccess: (tokens) => setTokens(tokens),
  });
}
