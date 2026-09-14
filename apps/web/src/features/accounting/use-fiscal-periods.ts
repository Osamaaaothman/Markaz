import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface FiscalPeriodSummary {
  readonly id: string;
  readonly periodNumber: number;
  readonly startDate: string;
  readonly endDate: string;
}

export function useFiscalPeriods() {
  return useQuery({
    queryKey: ["fiscalPeriods"],
    queryFn: async () => (await apiClient.get<FiscalPeriodSummary[]>("/v1/fiscal-periods")).data,
    staleTime: 5 * 60_000,
  });
}
