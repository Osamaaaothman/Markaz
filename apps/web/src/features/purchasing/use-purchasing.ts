import { newId } from "@erp/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// ── Purchase requests ─────────────────────────────────────────────────────────

export type PurchaseRequestStatus = "PENDING" | "PROCESSED" | "REJECTED";

export interface PurchaseRequestSummary {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseRequestStatus;
  readonly notes: string | null;
  readonly rejectionReason: string | null;
  readonly lineCount: number;
  readonly purchaseOrderId: string | null;
  readonly createdAt: string;
}

export interface PurchaseRequestDetail extends PurchaseRequestSummary {
  readonly lines: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly itemCode: string;
    readonly itemName: string;
    readonly itemNameAr: string | null;
    readonly unit: string;
    readonly quantity: string;
    readonly notes: string | null;
  }[];
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export function usePurchaseRequests(status: PurchaseRequestStatus | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["purchaseRequests", "list", status],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Page<PurchaseRequestSummary>>("/v1/purchase-requests", {
          params: { limit: "50", ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("purchase_request:read"),
  });
}

export function usePurchaseRequest(id: string | null) {
  return useQuery({
    queryKey: ["purchaseRequests", "detail", id],
    queryFn: async () => (await apiClient.get<PurchaseRequestDetail>(`/v1/purchase-requests/${id}`)).data,
    enabled: id !== null && id !== "",
    staleTime: 10_000,
  });
}

export interface CreatePurchaseRequestPayload {
  readonly notes?: string;
  readonly lines: readonly { readonly itemId: string; readonly quantity: string; readonly notes?: string }[];
}

export function useCreatePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePurchaseRequestPayload) =>
      (await apiClient.post<PurchaseRequestSummary>("/v1/purchase-requests", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["purchaseRequests"] }),
  });
}

export function useRejectPurchaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly id: string; readonly reason: string }) =>
      (await apiClient.post<PurchaseRequestSummary>(`/v1/purchase-requests/${input.id}/reject`, { reason: input.reason })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["purchaseRequests"] }),
  });
}

// ── Purchase orders ───────────────────────────────────────────────────────────

export type PurchaseOrderStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseOrderStatus;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierNameAr: string | null;
  readonly orderDate: string;
  readonly expectedDate: string | null;
  readonly currency: string;
  readonly totalAmount: string;
  readonly lineCount: number;
  readonly createdAt: string;
}

export interface PurchaseOrderLine {
  readonly id: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly receivedQuantity: string;
  readonly lineTotal: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  readonly notes: string | null;
  readonly lines: readonly PurchaseOrderLine[];
}

export function usePurchaseOrders(status: PurchaseOrderStatus | null) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["purchaseOrders", "list", status],
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<Page<PurchaseOrderSummary>>("/v1/purchase-orders", {
          params: { limit: "50", ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: can("purchase_order:read"),
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["purchaseOrders", "detail", id],
    queryFn: async () => (await apiClient.get<PurchaseOrderDetail>(`/v1/purchase-orders/${id}`)).data,
    enabled: id !== "",
    staleTime: 10_000,
  });
}

export interface CreatePurchaseOrderPayload {
  readonly supplierId: string;
  readonly orderDate: string;
  readonly expectedDate?: string;
  readonly notes?: string;
  readonly purchaseRequestId?: string;
  readonly lines: readonly { readonly itemId: string; readonly quantity: string; readonly unitPrice: string }[];
}

interface PurchaseOrderCreated {
  readonly id: string;
  readonly number: string;
  readonly status: PurchaseOrderStatus;
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePurchaseOrderPayload) =>
      (await apiClient.post<PurchaseOrderCreated>("/v1/purchase-orders", payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["purchaseRequests"] });
    },
  });
}

export function useOrderAction(id: string, action: "approve" | "reject" | "cancel") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason?: string) =>
      (await apiClient.post<PurchaseOrderCreated>(`/v1/purchase-orders/${id}/${action}`, reason ? { reason } : {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["purchaseOrders"] }),
  });
}

export interface ReceivePayload {
  readonly warehouseId: string;
  readonly documentDate: string;
  readonly reference?: string;
  readonly lines: readonly { readonly purchaseOrderLineId: string; readonly quantity: string }[];
}

export function useReceiveOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ReceivePayload) =>
      (
        await apiClient.post<{ id: string; number: string; orderStatus: string }>(`/v1/purchase-orders/${id}/receive`, payload, {
          // docs/04-DATA-MODEL-RULES.md §6: a fresh Idempotency-Key per genuine submission.
          headers: { "Idempotency-Key": newId() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchaseOrders"] });
      void qc.invalidateQueries({ queryKey: ["stockLevels"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

// ── Approval policy ───────────────────────────────────────────────────────────

export interface ApprovalPolicyEntry {
  readonly subjectType: "purchase_order";
  readonly thresholdAmount: string | null;
  readonly currency: string;
}

export function useApprovalPolicies() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["approvalPolicies"],
    queryFn: async () => (await apiClient.get<ApprovalPolicyEntry[]>("/v1/approval-policies")).data,
    staleTime: 60_000,
    enabled: can("approval_policy:read"),
  });
}

export function useSetApprovalPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly subjectType: string; readonly thresholdAmount: string | null }) =>
      (await apiClient.put<ApprovalPolicyEntry>(`/v1/approval-policies/${input.subjectType}`, { thresholdAmount: input.thresholdAmount })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["approvalPolicies"] }),
  });
}
