import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";

export interface IncomeStatementLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly amount: string;
}

export interface IncomeStatementSection {
  readonly lines: readonly IncomeStatementLine[];
  readonly total: string;
}

export interface IncomeStatementResult {
  readonly from: string;
  readonly to: string;
  readonly revenue: IncomeStatementSection;
  readonly expense: IncomeStatementSection;
  readonly netIncome: string;
}

// `from`/`to` are date-only ISO strings ("YYYY-MM-DD"); the query is disabled until
// both are set, so callers can wait on a sensible default range (e.g. the current
// fiscal year) before firing the request.
export function useIncomeStatement(from: string, to: string) {
  return useQuery({
    queryKey: ["incomeStatement", from, to],
    queryFn: async () =>
      (
        await apiClient.get<IncomeStatementResult>("/v1/income-statement", {
          params: { from, to },
        })
      ).data,
    enabled: from.length > 0 && to.length > 0,
    staleTime: 10_000,
  });
}
