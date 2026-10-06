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
  readonly number: string;
  readonly supplierInvoiceNumber: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly invoiceDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function useSupplierInvoices() {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["supplierInvoices", "list"],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Page<SupplierInvoiceSummary>>("/v1/supplier-invoices", {
          params: { limit: "50", ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("supplier_invoice:read"),
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
    mutationFn: async (payload: InvoicePayload) => (await apiClient.post<InvoicePreview>("/v1/supplier-invoices/preview", payload)).data,
  });
}

export function usePostInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InvoicePayload) =>
      (
        await apiClient.post<{ id: string; number: string; totalGross: string }>("/v1/supplier-invoices", payload, {
          // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
          headers: { "Idempotency-Key": newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplierInvoices"] });
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}
