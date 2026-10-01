import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface UserRoleSummary {
  readonly id: string;
  readonly name: string;
}

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly isActive: boolean;
  readonly roles: readonly UserRoleSummary[];
}

export interface CreateUserPayload {
  readonly email: string;
  readonly password: string;
  readonly roleIds?: string[];
}

export function useUsers() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => (await apiClient.get<UserSummary[]>("/v1/users")).data,
    staleTime: 30_000,
    enabled: can("user:read"),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) => apiClient.post("/v1/users", payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useAssignUserRoles(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleIds: string[]) => apiClient.put(`/v1/users/${userId}/roles`, { roleIds }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
