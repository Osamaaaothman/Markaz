import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface CashFlowLine {
  readonly label: string;
  readonly labelAr: string;
  readonly amount: string;
}

export interface CashFlowSection {
  readonly lines: readonly CashFlowLine[];
  readonly total: string;
}

export interface CashFlowResult {
  readonly from: string;
  readonly to: string;
  readonly operating: CashFlowSection;
  readonly investing: CashFlowSection;
  readonly financing: CashFlowSection;
  readonly netChange: string;
  readonly beginningCash: string;
  readonly endingCash: string;
  readonly isBalanced: boolean;
}

export function useCashFlow(from: string, to: string) {
  return useQuery({
    queryKey: ["cashFlow", from, to],
    queryFn: async () =>
      (
        await apiClient.get<CashFlowResult>("/v1/cash-flow", {
          params: { from, to },
        })
      ).data,
    enabled: from.length > 0 && to.length > 0,
    staleTime: 10_000,
  });
}
