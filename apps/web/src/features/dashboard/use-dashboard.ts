import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface AgingSummary {
  readonly total: string;
  readonly overdue: string;
}

export interface MonthlyResult {
  readonly month: string; // "YYYY-MM"
  readonly revenue: string;
  readonly expense: string;
}

// Each section is present only if the signed-in user may read the report behind it.
export interface DashboardData {
  readonly asOf: string;
  readonly currency: string;
  readonly receivables?: AgingSummary;
  readonly payables?: AgingSummary;
  readonly cash?: { readonly balance: string | null };
  readonly monthly?: readonly MonthlyResult[];
  readonly stock?: { readonly value: string; readonly belowReorder: number };
  readonly sales?: { readonly thisMonthNet: string; readonly openQuotations: number; readonly openOrders: number };
  readonly purchasing?: { readonly pendingApprovals: number; readonly openOrders: number; readonly pendingRequests: number };
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await apiClient.get<DashboardData>("/v1/dashboard")).data,
    staleTime: 30_000,
  });
}
