import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// ── Tax codes ─────────────────────────────────────────────────────────────────

export type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";

export interface TaxCodeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly rate: string;
  readonly treatment: TaxTreatment;
  readonly isActive: boolean;
}

export function useTaxCodes(includeInactive: boolean) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["taxCodes", includeInactive],
    queryFn: async () =>
      (await apiClient.get<TaxCodeSummary[]>("/v1/tax-codes", { params: includeInactive ? { includeInactive: "true" } : {} })).data,
    staleTime: 60_000,
    enabled: can("tax_code:read"),
  });
}

export function useCreateTaxCode() {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: { code: string; name: string; nameAr?: string; rate: string; treatment: TaxTreatment }) =>
      (await apiClient.post<TaxCodeSummary>("/v1/tax-codes", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["taxCodes"] }),
  });
}

export function useUpdateTaxCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) =>
      (await apiClient.patch<TaxCodeSummary>(`/v1/tax-codes/${input.id}`, { isActive: input.isActive })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["taxCodes"] }),
  });
}

export function useAddSaudiTaxCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<TaxCodeSummary[]>("/v1/tax-codes/saudi-defaults")).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["taxCodes"] }),
  });
}

// ── Supplier invoices ─────────────────────────────────────────────────────────

export interface SupplierInvoiceSummary {
  readonly id: string;
  readonly documentType: "INVOICE" | "DEBIT_NOTE";
  readonly number: string;
  readonly supplierInvoiceNumber: string | null;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly originalInvoiceId: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

export interface SupplierInvoiceLineDetail {
  readonly id: string;
  readonly taxCodeId: string;
  readonly originalLineId: string | null;
  readonly returnableQuantity: string;
  readonly lineNumber: number;
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly itemNameAr: string | null;
  readonly accountCode: string | null;
  readonly accountName: string | null;
  readonly accountNameAr: string | null;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly netAmount: string;
  readonly taxCode: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly priceVariance: string;
}

export interface SupplierInvoiceDetail extends SupplierInvoiceSummary {
  readonly notes: string | null;
  readonly purchaseOrderId: string | null;
  readonly purchaseOrderNumber: string | null;
  readonly originalInvoiceNumber: string | null;
  readonly journalEntryId: string;
  readonly lines: readonly SupplierInvoiceLineDetail[];
  readonly payments: readonly { readonly paymentId: string; readonly number: string; readonly paymentDate: string; readonly amount: string }[];
  readonly debitNotes: readonly { readonly id: string; readonly number: string; readonly totalGross: string }[];
  readonly outstanding: string | null;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useSupplierInvoices(documentType: "INVOICE" | "DEBIT_NOTE" | null = null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["supplierInvoices", "list", documentType],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Page<SupplierInvoiceSummary>>("/v1/supplier-invoices", {
          params: { limit: "50", ...(documentType ? { documentType } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("supplier_invoice:read"),
  });
}

export function useSupplierInvoice(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["supplierInvoices", "detail", id],
    queryFn: async () => (await apiClient.get<SupplierInvoiceDetail>(`/v1/supplier-invoices/${id}`)).data,
    enabled: can("supplier_invoice:read") && id !== "",
  });
}

export interface DebitNotePayload {
  readonly debitDate: string;
  readonly notes?: string;
  readonly lines: readonly { readonly originalLineId?: string; readonly warehouseId?: string; readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly taxCodeId: string; readonly accountId: string }[];
}

export function useCreateDebitNote(invoiceId: string, submissionKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: DebitNotePayload) =>
      (
        await apiClient.post<{ id: string; number: string }>(`/v1/supplier-invoices/${invoiceId}/debit-notes`, payload, {
          headers: { "Idempotency-Key": submissionKey ?? newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["stockMovements"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export interface InvoiceableLine {
  readonly purchaseOrderLineId: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderNumber: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly unit: string;
  readonly orderPrice: string;
  readonly invoiceableQuantity: string;
}

export function useInvoiceableLines(supplierId: string) {
  return useQuery({
    queryKey: ["supplierInvoices", "invoiceable", supplierId],
    queryFn: async () => (await apiClient.get<InvoiceableLine[]>("/v1/supplier-invoices/invoiceable", { params: { supplierId } })).data,
    enabled: supplierId !== "",
    staleTime: 0,
  });
}

export interface InvoiceLinePayload {
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly purchaseOrderLineId?: string;
  readonly accountId?: string;
  readonly description?: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxCodeId: string;
}

export interface InvoicePayload {
  readonly supplierId: string;
  readonly supplierInvoiceNumber: string;
  readonly invoiceDate: string;
  readonly dueDate?: string;
  readonly notes?: string;
  readonly acceptPriceVariance?: boolean;
  readonly lines: readonly InvoiceLinePayload[];
}

export interface InvoicePreviewLine {
  readonly lineNumber: number;
  readonly kind: "PO_LINE" | "EXPENSE";
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly orderPrice: string | null;
  readonly net: string;
  readonly taxRate: string;
  readonly tax: string;
  readonly priceVariance: string;
  readonly invoiceableQuantity: string | null;
  readonly issue: "QTY_EXCEEDS_RECEIVED" | null;
}

export interface InvoicePreview {
  readonly lines: readonly InvoicePreviewLine[];
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly totalPriceVariance: string;
  readonly hasPriceVariance: boolean;
  readonly canPost: boolean;
}

export function usePreviewInvoice() {
  return useMutation({
    meta: { feedback: "silent" },
    mutationFn: async (payload: InvoicePayload) => (await apiClient.post<InvoicePreview>("/v1/supplier-invoices/preview", payload)).data,
  });
}

export function usePostInvoice(submissionKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async (payload: InvoicePayload) =>
      (
        await apiClient.post<{ id: string; number: string; totalGross: string }>("/v1/supplier-invoices", payload, {
          // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
          headers: { "Idempotency-Key": submissionKey ?? newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
