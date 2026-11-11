import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export type PaymentDirection = "RECEIPT" | "PAYMENT";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"];

export interface PaymentSummary {
  readonly id: string;
  readonly direction: PaymentDirection;
  readonly number: string;
  readonly partyId: string;
  readonly partyName: string;
  readonly partyNameAr: string | null;
  readonly paymentDate: string;
  readonly amount: string;
  readonly allocated: string;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
}

export interface PaymentAllocationView {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly invoiceKind: "SALES" | "SUPPLIER";
  readonly amount: string;
}

export interface PaymentDetail extends PaymentSummary {
  readonly cashAccountCode: string;
  readonly cashAccountName: string;
  readonly cashAccountNameAr: string | null;
  readonly notes: string | null;
  readonly journalEntryId: string;
  readonly allocations: readonly PaymentAllocationView[];
  readonly unallocated: string;
  readonly voidedAt: string | null;
  readonly reversesPaymentId: string | null;
  readonly reversedByPaymentId: string | null;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function usePayments(direction: PaymentDirection | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["payments", "list", direction],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<PaymentSummary>>("/v1/payments", { params: { limit: "50", ...(direction ? { direction } : {}), ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("payment:read"),
  });
}

export function usePayment(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["payments", "detail", id],
    queryFn: async () => (await apiClient.get<PaymentDetail>(`/v1/payments/${id}`)).data,
    enabled: can("payment:read") && id !== "",
  });
}

export interface OpenInvoice {
  readonly id: string;
  readonly number: string;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly gross: string;
  readonly outstanding: string;
}

export function useOpenInvoices(partyId: string, direction: PaymentDirection) {
  return useQuery({
    queryKey: ["payments", "open", partyId, direction],
    queryFn: async () => (await apiClient.get<OpenInvoice[]>("/v1/payments/open-invoices", { params: { partyId, direction } })).data,
    enabled: partyId !== "",
    staleTime: 0,
  });
}

export interface UnallocatedPayment {
  readonly id: string;
  readonly number: string;
  readonly paymentDate: string;
  readonly method: PaymentMethod;
  readonly unallocated: string;
}

export interface PartyBalance {
  readonly totalUnallocated: string;
  readonly unallocatedPayments: readonly UnallocatedPayment[];
  readonly openInvoices: readonly OpenInvoice[];
}

export function usePartyBalance(partyId: string, direction: PaymentDirection) {
  return useQuery({
    queryKey: ["payments", "balance", partyId, direction],
    queryFn: async () => (await apiClient.get<PartyBalance>("/v1/payments/balance", { params: { partyId, direction } })).data,
    enabled: partyId !== "",
    staleTime: 0,
  });
}

export interface SettlePayload {
  readonly partyId: string;
  readonly direction: PaymentDirection;
  readonly allocations: readonly { readonly invoiceId: string; readonly amount: string }[];
}

export function useSettle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SettlePayload) => (await apiClient.post<{ totalAllocated: string }>("/v1/payments/settle", payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["salesInvoices"] });
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

export interface CreatePaymentPayload {
  readonly partyId: string;
  readonly paymentDate: string;
  readonly amount: string;
  readonly cashAccountId: string;
  readonly method: PaymentMethod;
  readonly reference?: string;
  readonly notes?: string;
  readonly allocations: readonly { readonly invoiceId: string; readonly amount: string }[];
}

export function useCreatePayment(direction: PaymentDirection, submissionKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: CreatePaymentPayload) =>
      (
        await apiClient.post<{ id: string; number: string; unallocated: string }>(direction === "RECEIPT" ? "/v1/customer-receipts" : "/v1/supplier-payments", payload, {
          // A restored draft retains its submission key across retries.
          headers: { "Idempotency-Key": submissionKey ?? newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["salesInvoices"] });
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

export function useReversePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<{ id: string; number: string; journalEntryId: string }>(`/v1/payments/${id}/reverse`, {}, { headers: { "Idempotency-Key": newId() } })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["salesInvoices"] });
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
