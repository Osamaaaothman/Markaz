import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface AllowanceTypeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly isHousing: boolean;
  readonly inGosiBase: boolean;
  readonly inEosbBase: boolean;
  readonly isActive: boolean;
}

export function useAllowanceTypes(includeInactive = false) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["allowanceTypes", includeInactive],
    queryFn: async () => (await apiClient.get<AllowanceTypeSummary[]>("/v1/allowance-types", { params: includeInactive ? { includeInactive: "true" } : {} })).data,
    staleTime: 30_000,
    enabled: can("employee:read"),
  });
}

export interface CreateAllowanceTypePayload {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly isHousing?: boolean;
  readonly inGosiBase?: boolean;
  readonly inEosbBase?: boolean;
}

export interface UpdateAllowanceTypePayload {
  readonly name?: string;
  readonly nameAr?: string;
  readonly inGosiBase?: boolean;
  readonly inEosbBase?: boolean;
  readonly isActive?: boolean;
}

export function useCreateAllowanceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAllowanceTypePayload) => (await apiClient.post<AllowanceTypeSummary>("/v1/allowance-types", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["allowanceTypes"] }),
  });
}

export function useUpdateAllowanceType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateAllowanceTypePayload & { readonly id: string }) =>
      (await apiClient.put<AllowanceTypeSummary>(`/v1/allowance-types/${id}`, payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["allowanceTypes"] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useAddCommonAllowanceTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<{ added: number }>("/v1/allowance-types/add-common", {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["allowanceTypes"] }),
  });
}

export const allowanceErrorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;
