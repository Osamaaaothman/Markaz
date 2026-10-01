import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export interface FiscalPeriodSummary {
  readonly id: string;
  readonly periodNumber: number;
  readonly startDate: string;
  readonly endDate: string;
}

export function useFiscalPeriods() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["fiscalPeriods"],
    queryFn: async () => (await apiClient.get<FiscalPeriodSummary[]>("/v1/fiscal-periods")).data,
    staleTime: 5 * 60_000,
    enabled: can("fiscal_period:read"),
  });
}
