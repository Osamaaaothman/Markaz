import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export type HrPaymentKind = "SALARY" | "GOSI" | "END_OF_SERVICE";

export interface HrPaymentSummary {
  readonly id: string;
  readonly kind: HrPaymentKind;
  readonly number: string;
  readonly paymentDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly payrollRunId: string | null;
  readonly payrollRunNumber: string | null;
  readonly settlementId: string | null;
  readonly settlementNumber: string | null;
  readonly employeeName: string | null;
  readonly employeeNameAr: string | null;
}

export interface HrPaymentDetail extends HrPaymentSummary {
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly notes: string | null;
  readonly journalEntryId: string;
  readonly items: readonly { readonly employeeId: string; readonly employeeRef: string; readonly employeeName: string; readonly employeeNameAr: string | null; readonly amount: string }[];
}

export interface HrPayables {
  readonly currency: string;
  readonly runs: readonly { readonly payrollRunId: string; readonly number: string; readonly runDate: string; readonly unpaidCount: number; readonly unpaidTotal: string }[];
  readonly gosiOutstanding: string;
  readonly settlements: readonly { readonly settlementId: string; readonly number: string; readonly employeeName: string; readonly employeeNameAr: string | null; readonly terminationDate: string; readonly amount: string }[];
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useHrPayments() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["hrPayments", "list"],
    queryFn: async ({ pageParam }) => (await apiClient.get<Page<HrPaymentSummary>>("/v1/hr-payments", { params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("hr_payment:read"),
  });
}

export function useHrPayment(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["hrPayments", "detail", id],
    queryFn: async () => (await apiClient.get<HrPaymentDetail>(`/v1/hr-payments/${id}`)).data,
    enabled: can("hr_payment:read") && id !== "",
  });
}

export function useHrPayables() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["hrPayments", "payables"],
    queryFn: async () => (await apiClient.get<HrPayables>("/v1/hr-payments/payables")).data,
    staleTime: 5_000,
    enabled: can("hr_payment:read"),
  });
}

interface Common {
  readonly paymentDate: string;
  readonly cashAccountId: string;
  readonly notes?: string;
}

function usePay<P extends Common>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: P) =>
      (await apiClient.post<{ id: string; number: string; amount: string }>(`/v1/hr-payments/${path}`, payload, { headers: { "Idempotency-Key": newId() } })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hrPayments"] });
      void qc.invalidateQueries({ queryKey: ["trialBalance"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

export const usePaySalaries = () => usePay<Common & { readonly payrollRunId: string; readonly employeeIds?: readonly string[] }>("salaries");
export const usePayGosi = () => usePay<Common & { readonly amount: string }>("gosi");
export const usePayEndOfService = () => usePay<Common & { readonly settlementId: string }>("end-of-service");

export const hrPaymentErrorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;
