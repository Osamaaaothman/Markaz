import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

export interface PermissionEntry {
  readonly code: string;
  readonly description: string | null;
}

export interface CreateRolePayload {
  readonly name: string;
  readonly permissionCodes: string[];
}

export function useRoles() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await apiClient.get<RoleSummary[]>("/v1/roles")).data,
    staleTime: 60_000,
    enabled: can("role:read"),
  });
}

export function usePermissionCatalog() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await apiClient.get<PermissionEntry[]>("/v1/roles/permissions")).data,
    staleTime: 5 * 60_000,
    enabled: can("role:read"),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRolePayload) => apiClient.post("/v1/roles", payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}
