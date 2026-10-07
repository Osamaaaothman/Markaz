import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface SalesLineView {
  readonly id: string;
  readonly itemId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly taxRate: string;
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly invoicedQuantity?: string;
}

export interface SalesLinePayload {
  readonly itemId?: string;
  readonly description?: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
  readonly warehouseId?: string;
  readonly salesOrderLineId?: string;
}

// ── Quotations ────────────────────────────────────────────────────────────────

export type QuotationStatus = "OPEN" | "CONVERTED" | "REJECTED" | "CANCELLED";

export interface QuotationSummary {
  readonly id: string;
  readonly number: string;
  readonly status: QuotationStatus;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly quotationDate: string;
  readonly validUntil: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly salesOrderId: string | null;
}

export interface QuotationDetail extends QuotationSummary {
  readonly notes: string | null;
  readonly lines: readonly SalesLineView[];
}

export function useQuotations(status: QuotationStatus | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["quotations", "list", status],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<QuotationSummary>>("/v1/quotations", { params: { limit: "50", ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("quotation:read"),
  });
}

export function useQuotation(id: string | null) {
  return useQuery({
    queryKey: ["quotations", "detail", id],
    queryFn: async () => (await apiClient.get<QuotationDetail>(`/v1/quotations/${id}`)).data,
    enabled: id !== null && id !== "",
    staleTime: 10_000,
  });
}

export interface CreateQuotationPayload {
  readonly customerId: string;
  readonly quotationDate: string;
  readonly validUntil?: string;
  readonly notes?: string;
  readonly lines: readonly SalesLinePayload[];
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateQuotationPayload) => (await apiClient.post<QuotationSummary>("/v1/quotations", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["quotations"] }),
  });
}

export function useQuotationAction(id: string, action: "reject" | "cancel" | "convert") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<{ id: string }>(`/v1/quotations/${id}/${action}`, {})).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quotations"] });
      void qc.invalidateQueries({ queryKey: ["salesOrders"] });
    },
  });
}

// ── Sales orders ──────────────────────────────────────────────────────────────

export type SalesOrderStatus = "OPEN" | "PARTIALLY_INVOICED" | "INVOICED" | "CANCELLED";

export interface SalesOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: SalesOrderStatus;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly orderDate: string;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  readonly notes: string | null;
  readonly lines: readonly SalesLineView[];
}

export function useSalesOrders(status: SalesOrderStatus | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["salesOrders", "list", status],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get<Page<SalesOrderSummary>>("/v1/sales-orders", { params: { limit: "50", ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) } })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("sales_order:read"),
  });
}

export function useSalesOrder(id: string | null) {
  return useQuery({
    queryKey: ["salesOrders", "detail", id],
    queryFn: async () => (await apiClient.get<SalesOrderDetail>(`/v1/sales-orders/${id}`)).data,
    enabled: id !== null && id !== "",
    staleTime: 5_000,
  });
}

export interface CreateSalesOrderPayload {
  readonly customerId: string;
  readonly orderDate: string;
  readonly notes?: string;
  readonly lines: readonly SalesLinePayload[];
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateSalesOrderPayload) => (await apiClient.post<{ id: string; number: string }>("/v1/sales-orders", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["salesOrders"] }),
  });
}

export function useCancelSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<{ id: string }>(`/v1/sales-orders/${id}/cancel`, {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["salesOrders"] }),
  });
}

// ── Invoices and credit notes ─────────────────────────────────────────────────

export interface SalesInvoiceSummary {
  readonly id: string;
  readonly documentType: "INVOICE" | "CREDIT_NOTE";
  readonly number: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  readonly originalInvoiceId: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SalesInvoiceDetail extends SalesInvoiceSummary {
  readonly notes: string | null;
  readonly lines: readonly {
    readonly id: string;
    readonly description: string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly netAmount: string;
    readonly taxRate: string;
    readonly taxAmount: string;
  }[];
}

export function useSalesInvoices(documentType: "INVOICE" | "CREDIT_NOTE" | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["salesInvoices", "list", documentType],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Page<SalesInvoiceSummary>>("/v1/sales-invoices", {
          params: { limit: "50", ...(documentType ? { documentType } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("sales_invoice:read"),
  });
}

export function useSalesInvoice(id: string) {
  return useQuery({
    queryKey: ["salesInvoices", "detail", id],
    queryFn: async () => (await apiClient.get<SalesInvoiceDetail>(`/v1/sales-invoices/${id}`)).data,
    enabled: id !== "",
    staleTime: 10_000,
  });
}

export interface CreateSalesInvoicePayload {
  readonly customerId: string;
  readonly invoiceDate: string;
  readonly dueDate?: string;
  readonly notes?: string;
  readonly lines: readonly SalesLinePayload[];
}

function invalidateAfterPosting(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ["salesInvoices"] });
  void qc.invalidateQueries({ queryKey: ["salesOrders"] });
  void qc.invalidateQueries({ queryKey: ["stockLevels"] });
  void qc.invalidateQueries({ queryKey: ["accountBalances"] });
}

export function useCreateSalesInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateSalesInvoicePayload) =>
      (
        await apiClient.post<{ id: string; number: string; totalGross: string }>("/v1/sales-invoices", payload, {
          // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
          headers: { "Idempotency-Key": newId() },
        })
      ).data,
    onSuccess: () => invalidateAfterPosting(qc),
  });
}

export interface CreditNotePayload {
  readonly creditDate: string;
  readonly notes?: string;
  readonly lines: readonly { readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly taxCodeId: string }[];
}

export function useCreateCreditNote(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreditNotePayload) =>
      (
        await apiClient.post<{ id: string; number: string }>(`/v1/sales-invoices/${invoiceId}/credit-notes`, payload, {
          headers: { "Idempotency-Key": newId() },
        })
      ).data,
    onSuccess: () => invalidateAfterPosting(qc),
  });
}
