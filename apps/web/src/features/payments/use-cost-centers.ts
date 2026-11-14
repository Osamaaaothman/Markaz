import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface CostCenterInput {
  code: string;
  name: string;
  nameAr: string;
  kind: "COST_CENTER" | "PROJECT" | "DEPARTMENT";
  isActive: boolean;
}
export interface CostCenter extends Omit<CostCenterInput, "nameAr"> { id: string; nameAr: string | null }

export function useCostCenters(enabled = true) {
  return useQuery({ queryKey: ["costCenters"], queryFn: async () => (await apiClient.get<CostCenter[]>("/v1/cost-centers")).data, enabled });
}

export function useSaveCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: CostCenterInput & { id?: string }) =>
      (id ? await apiClient.put<CostCenter>(`/v1/cost-centers/${id}`, input) : await apiClient.post<CostCenter>("/v1/cost-centers", input)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["costCenters"] }); },
  });
}
