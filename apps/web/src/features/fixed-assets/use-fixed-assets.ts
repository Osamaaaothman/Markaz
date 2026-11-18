import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// ── Types (mirror packages/core/src/fixed-assets) ─────────────────────────────

export type AssetStatus = "DRAFT" | "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
export type DisposalType = "SCRAP" | "LOSS" | "WRITE_OFF";

export interface NamedRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export interface AssetCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly numberPrefix: string;
  readonly depreciationMethod: string;
  readonly isDepreciable: boolean;
  readonly defaultUsefulLifeMonths: number | null;
  readonly defaultResidualPercent: string;
  readonly assetAccount: NamedRef;
  readonly accumulatedDepreciationAccount: NamedRef | null;
  readonly depreciationExpenseAccount: NamedRef | null;
  readonly isActive: boolean;
  readonly assetCount: number;
  readonly isLocked: boolean;
}

export interface AssetCategoryPayload {
  readonly code?: string;
  readonly name: string;
  readonly nameAr?: string;
  readonly numberPrefix: string;
  readonly isDepreciable: boolean;
  readonly defaultUsefulLifeMonths?: number;
  readonly defaultResidualPercent?: string;
  readonly assetAccountId: string;
  readonly accumulatedDepreciationAccountId?: string;
  readonly depreciationExpenseAccountId?: string;
  readonly isActive?: boolean;
}

export interface FixedAssetSummary {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly status: AssetStatus;
  readonly category: NamedRef;
  readonly acquisitionDate: string;
  readonly inServiceDate: string;
  readonly acquisitionCost: string;
  readonly residualValue: string;
  readonly usefulLifeMonths: number | null;
  readonly accumulatedDepreciation: string;
  readonly netBookValue: string;
  readonly depreciatedThrough: string | null;
  readonly currency: string;
  readonly sourceType: "MANUAL" | "OPENING" | "SUPPLIER_INVOICE";
  readonly custodian: { readonly id: string; readonly ref: string; readonly name: string; readonly nameAr: string | null } | null;
  readonly costCenter: NamedRef | null;
  readonly location: string | null;
}

export interface FixedAssetListPage {
  readonly items: readonly FixedAssetSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totals: { readonly acquisitionCost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string };
}

export interface ScheduleRow {
  readonly year: number;
  readonly month: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly amount: string;
  readonly accumulated: string;
  readonly netBookValue: string;
}

export interface DepreciationHistoryRow {
  readonly runId: string;
  readonly runNumber: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly amount: string;
  readonly accumulatedAfter: string;
  readonly netBookValueAfter: string;
  readonly isCatchUp: boolean;
  readonly journalEntryId: string;
}

export interface TransferRow {
  readonly id: string;
  readonly transferDate: string;
  readonly fromLocation: string | null;
  readonly toLocation: string | null;
  readonly fromCustodian: string | null;
  readonly toCustodian: string | null;
  readonly fromCostCenter: string | null;
  readonly toCostCenter: string | null;
  readonly reason: string | null;
}

export interface FixedAssetDetail extends FixedAssetSummary {
  readonly description: string | null;
  readonly depreciationMethod: string;
  readonly isDepreciable: boolean;
  readonly openingAccumulatedDepreciation: string;
  readonly openingAsOfDate: string | null;
  readonly lastDepreciationDay: string | null;
  readonly serialNumber: string | null;
  readonly barcode: string | null;
  readonly supplier: { readonly id: string; readonly ref: string; readonly name: string } | null;
  readonly sourceAccount: NamedRef | null;
  readonly capitalizationJournalEntryId: string | null;
  readonly capitalizedAt: string | null;
  readonly supplierInvoiceId: string | null;
  readonly disposal: {
    readonly id: string;
    readonly number: string;
    readonly disposalDate: string;
    readonly disposalType: DisposalType;
    readonly gainLoss: string;
    readonly finalDepreciationAmount: string;
    readonly reason: string;
    readonly journalEntryId: string;
  } | null;
  readonly depreciationHistory: readonly DepreciationHistoryRow[];
  readonly projectedSchedule: readonly ScheduleRow[];
  readonly transfers: readonly TransferRow[];
  readonly version: number;
}

export interface FixedAssetDetailsPayload {
  readonly name: string;
  readonly nameAr?: string;
  readonly description?: string;
  readonly categoryId: string;
  readonly acquisitionDate: string;
  readonly inServiceDate: string;
  readonly acquisitionCost: string;
  readonly residualValue?: string;
  readonly usefulLifeMonths?: number;
  readonly supplierPartyId?: string;
  readonly custodianEmployeeId?: string;
  readonly costCenterId?: string;
  readonly location?: string;
  readonly serialNumber?: string;
  readonly barcode?: string;
}

export interface OpeningAssetPayload extends FixedAssetDetailsPayload {
  readonly openingAccumulatedDepreciation: string;
  readonly openingAsOfDate: string;
}

export interface AssetInfoPayload {
  readonly name?: string;
  readonly nameAr?: string;
  readonly description?: string;
  readonly serialNumber?: string;
  readonly barcode?: string;
}

export interface TransferPayload {
  readonly transferDate: string;
  readonly location?: string;
  readonly custodianEmployeeId?: string;
  readonly costCenterId?: string;
  readonly reason?: string;
}

export interface DisposalPreview {
  readonly assetId: string;
  readonly disposalDate: string;
  readonly cost: string;
  readonly accumulatedBefore: string;
  readonly finalDepreciationAmount: string;
  readonly finalDepreciationDays: number;
  readonly finalDepreciationFrom: string | null;
  readonly accumulatedAtDisposal: string;
  readonly netBookValue: string;
  readonly gainLoss: string;
  readonly lines: readonly { readonly accountId: string; readonly accountCode: string; readonly accountName: string; readonly accountNameAr: string | null; readonly debit: string; readonly credit: string }[];
}

export interface DepreciationLine {
  readonly assetId: string;
  readonly assetNumber: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly categoryName: string;
  readonly categoryNameAr: string | null;
  readonly costCenterId: string | null;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly amount: string;
  readonly accumulatedAfter: string;
  readonly netBookValueAfter: string;
  readonly isCatchUp: boolean;
  readonly fullyDepreciated: boolean;
}

export interface DepreciationPreview {
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalAmount: string;
  readonly lines: readonly DepreciationLine[];
}

export interface DepreciationRunSummary {
  readonly id: string;
  readonly number: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalAmount: string;
  readonly assetCount: number;
  readonly status: "POSTED" | "REVERSED";
  readonly journalEntryId: string;
  readonly reversalJournalEntryId: string | null;
  readonly reversalReason: string | null;
  readonly reversedAt: string | null;
  readonly createdAt: string;
}

export interface DepreciationRunDetail extends DepreciationRunSummary {
  readonly lines: readonly DepreciationLine[];
  readonly canReverse: boolean;
}

export interface RegisterReport {
  readonly asOf: string;
  readonly currency: string;
  readonly rows: readonly {
    readonly assetId: string;
    readonly number: string;
    readonly name: string;
    readonly nameAr: string | null;
    readonly categoryId: string;
    readonly categoryName: string;
    readonly categoryNameAr: string | null;
    readonly inServiceDate: string;
    readonly usefulLifeMonths: number | null;
    readonly cost: string;
    readonly accumulatedDepreciation: string;
    readonly netBookValue: string;
    readonly location: string | null;
    readonly custodianName: string | null;
  }[];
  readonly byCategory: readonly { readonly categoryId: string; readonly categoryName: string; readonly categoryNameAr: string | null; readonly count: number; readonly cost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string }[];
  readonly totals: { readonly count: number; readonly cost: string; readonly accumulatedDepreciation: string; readonly netBookValue: string };
}

export interface MovementAmounts {
  readonly costOpening: string;
  readonly costAdditions: string;
  readonly costDisposals: string;
  readonly costClosing: string;
  readonly depreciationOpening: string;
  readonly depreciationOnOpeningAssets: string;
  readonly depreciationCharge: string;
  readonly depreciationOnDisposals: string;
  readonly depreciationClosing: string;
  readonly netBookValueOpening: string;
  readonly netBookValueClosing: string;
}

export interface MovementReport {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly rows: readonly (MovementAmounts & { readonly categoryId: string; readonly categoryName: string; readonly categoryNameAr: string | null })[];
  readonly totals: MovementAmounts;
}

export interface ReconciliationReport {
  readonly asOf: string;
  readonly currency: string;
  readonly isReconciled: boolean;
  readonly rows: readonly {
    readonly accountId: string;
    readonly accountCode: string;
    readonly accountName: string;
    readonly accountNameAr: string | null;
    readonly role: "COST" | "ACCUMULATED_DEPRECIATION";
    readonly registerAmount: string;
    readonly ledgerAmount: string;
    readonly difference: string;
  }[];
}

export interface AssetFilter {
  readonly status?: AssetStatus;
  readonly categoryId?: string;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

// The stable error code the API sends with every refusal (or undefined for a network/unknown failure).
export const fixedAssetErrorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

// Every code the module can send has its own message under fixedAssets.errors; anything else gets the generic one.
export const FIXED_ASSET_ERROR_CODES = new Set([
  "CATEGORY_NOT_FOUND", "CATEGORY_CODE_TAKEN", "PREFIX_TAKEN", "CATEGORY_IN_USE", "CATEGORY_INACTIVE", "ASSET_ACCOUNT_INVALID",
  "ACCUMULATED_ACCOUNT_INVALID", "EXPENSE_ACCOUNT_INVALID", "ACCOUNTS_NOT_DISTINCT", "DEPRECIABLE_NEEDS_ACCOUNTS", "ASSET_NOT_FOUND",
  "ASSET_NOT_DRAFT", "ASSET_NOT_IN_SERVICE", "SOURCE_ACCOUNT_INVALID", "EMPLOYEE_NOT_FOUND", "COST_CENTER_NOT_FOUND", "SUPPLIER_NOT_FOUND",
  "IN_SERVICE_BEFORE_ACQUISITION", "NO_OPEN_PERIOD", "RESIDUAL_EXCEEDS_COST", "LIFE_REQUIRED", "OPENING_EXCEEDS_DEPRECIABLE",
  "OPENING_AFTER_LIFE", "OPENING_DATE_REQUIRED", "OPENING_ON_NON_DEPRECIABLE", "FUTURE_PERIOD", "RUN_EXISTS", "RUN_BEFORE_LATEST",
  "NOTHING_TO_DEPRECIATE", "RUN_NOT_FOUND", "RUN_NOT_LATEST", "RUN_ALREADY_REVERSED", "RUN_HAS_DISPOSED_ASSET",
  "DISPOSAL_BEFORE_DEPRECIATED", "DISPOSAL_BEFORE_ACQUISITION", "NOTHING_CHANGED", "MAPPING_MISSING",
]);

export function fixedAssetErrorKey(error: unknown): string {
  const code = fixedAssetErrorCode(error);
  return code && FIXED_ASSET_ERROR_CODES.has(code) ? `fixedAssets.errors.${code}` : "fixedAssets.errors.generic";
}

// ── Invalidation ─────────────────────────────────────────────────────────────

function useInvalidateLedger() {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: ["fixedAssets"] });
    void qc.invalidateQueries({ queryKey: ["fixedAssetCategories"] });
    void qc.invalidateQueries({ queryKey: ["depreciationRuns"] });
    void qc.invalidateQueries({ queryKey: ["fixedAssetReports"] });
    void qc.invalidateQueries({ queryKey: ["trialBalance"] });
    void qc.invalidateQueries({ queryKey: ["journalEntries"] });
  };
}

const idem = (): { headers: Record<string, string> } => ({ headers: { "Idempotency-Key": crypto.randomUUID() } });

// ── Categories ────────────────────────────────────────────────────────────────

export function useAssetCategories(includeInactive = false) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["fixedAssetCategories", { includeInactive }],
    queryFn: async () => (await apiClient.get<AssetCategory[]>("/v1/fixed-asset-categories", { params: includeInactive ? { includeInactive: "true" } : {} })).data,
    staleTime: 60_000,
    enabled: can("fixed_asset_category:read"),
  });
}

export function useSaveAssetCategory() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async ({ id, ...payload }: AssetCategoryPayload & { id?: string }) =>
      (id ? await apiClient.patch<AssetCategory>(`/v1/fixed-asset-categories/${id}`, payload) : await apiClient.post<AssetCategory>("/v1/fixed-asset-categories", payload)).data,
    onSuccess: invalidate,
  });
}

// ── Register ──────────────────────────────────────────────────────────────────

export function useFixedAssets(filter: AssetFilter) {
  const { can } = usePermissions();
  const params: Record<string, string> = { page: String(filter.page), pageSize: String(filter.pageSize) };
  if (filter.status) params.status = filter.status;
  if (filter.categoryId) params.categoryId = filter.categoryId;
  if (filter.search?.trim()) params.search = filter.search.trim();
  return useQuery({
    queryKey: ["fixedAssets", "list", params],
    queryFn: async () => (await apiClient.get<FixedAssetListPage>("/v1/fixed-assets", { params })).data,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled: can("fixed_asset:read"),
  });
}

export function useFixedAsset(id: string) {
  return useQuery({
    queryKey: ["fixedAssets", "detail", id],
    queryFn: async () => (await apiClient.get<FixedAssetDetail>(`/v1/fixed-assets/${id}`)).data,
    enabled: id !== "",
  });
}

export function useCreateDraftAsset() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: FixedAssetDetailsPayload) => (await apiClient.post<FixedAssetSummary>("/v1/fixed-assets", payload)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateDraftAsset(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: FixedAssetDetailsPayload) => (await apiClient.patch<FixedAssetSummary>(`/v1/fixed-assets/${id}/draft`, payload)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateAssetInfo(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: AssetInfoPayload) => (await apiClient.patch<FixedAssetSummary>(`/v1/fixed-assets/${id}`, payload)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteDraftAsset() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/v1/fixed-assets/${id}`);
    },
    onSuccess: invalidate,
  });
}

export function useRegisterOpeningAsset() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: OpeningAssetPayload) => (await apiClient.post<{ id: string; number: string; journalEntryId: string }>("/v1/fixed-assets/opening", payload, idem())).data,
    onSuccess: invalidate,
  });
}

export function useCapitalizeAsset(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (sourceAccountId: string) => (await apiClient.post<{ id: string; number: string; journalEntryId: string }>(`/v1/fixed-assets/${id}/capitalize`, { sourceAccountId }, idem())).data,
    onSuccess: invalidate,
  });
}

export function useTransferAsset(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: TransferPayload) => (await apiClient.post<FixedAssetSummary>(`/v1/fixed-assets/${id}/transfer`, payload)).data,
    onSuccess: invalidate,
  });
}

export function useDisposalPreview(id: string, disposalDate: string | null) {
  return useQuery({
    queryKey: ["fixedAssets", "disposalPreview", id, disposalDate],
    queryFn: async () => (await apiClient.get<DisposalPreview>(`/v1/fixed-assets/${id}/disposal-preview`, { params: { disposalDate } })).data,
    enabled: id !== "" && disposalDate !== null,
    retry: false,
  });
}

export function useDisposeAsset(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (payload: { disposalDate: string; disposalType: DisposalType; reason: string }) =>
      (await apiClient.post<{ id: string; number: string; journalEntryId: string; gainLoss: string }>(`/v1/fixed-assets/${id}/dispose`, payload, idem())).data,
    onSuccess: invalidate,
  });
}

// ── Depreciation runs ─────────────────────────────────────────────────────────

export function useDepreciationRuns() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["depreciationRuns", "list"],
    queryFn: async () => (await apiClient.get<DepreciationRunSummary[]>("/v1/depreciation-runs")).data,
    staleTime: 15_000,
    enabled: can("depreciation_run:read"),
  });
}

export function useDepreciationRun(id: string) {
  return useQuery({
    queryKey: ["depreciationRuns", "detail", id],
    queryFn: async () => (await apiClient.get<DepreciationRunDetail>(`/v1/depreciation-runs/${id}`)).data,
    enabled: id !== "",
  });
}

export function useDepreciationPreview(period: { periodYear: number; periodMonth: number } | null) {
  return useQuery({
    queryKey: ["depreciationRuns", "preview", period],
    queryFn: async () => (await apiClient.get<DepreciationPreview>("/v1/depreciation-runs/preview", { params: period })).data,
    enabled: period !== null,
    retry: false,
    staleTime: 0,
  });
}

export function usePostDepreciationRun() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (period: { periodYear: number; periodMonth: number }) => (await apiClient.post<DepreciationRunDetail>("/v1/depreciation-runs", period, idem())).data,
    onSuccess: invalidate,
  });
}

export function useReverseDepreciationRun(id: string) {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: async (reason: string) => (await apiClient.post<DepreciationRunDetail>(`/v1/depreciation-runs/${id}/reverse`, { reason }, idem())).data,
    onSuccess: invalidate,
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

export function useRegisterReport(asOf: string) {
  return useQuery({
    queryKey: ["fixedAssetReports", "register", asOf],
    queryFn: async () => (await apiClient.get<RegisterReport>("/v1/fixed-assets/reports/register", { params: { asOf } })).data,
    placeholderData: keepPreviousData,
  });
}

export function useMovementReport(from: string, to: string) {
  return useQuery({
    queryKey: ["fixedAssetReports", "movement", from, to],
    queryFn: async () => (await apiClient.get<MovementReport>("/v1/fixed-assets/reports/movement", { params: { from, to } })).data,
    placeholderData: keepPreviousData,
    enabled: from <= to,
  });
}

export function useReconciliationReport(asOf: string) {
  return useQuery({
    queryKey: ["fixedAssetReports", "reconciliation", asOf],
    queryFn: async () => (await apiClient.get<ReconciliationReport>("/v1/fixed-assets/reports/reconciliation", { params: { asOf } })).data,
    placeholderData: keepPreviousData,
  });
}
