import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { newId } from "@erp/shared";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

export type ZatcaEnvironment = "sandbox" | "simulation" | "production";

export interface SellerProfileView {
  readonly name: string;
  readonly nameAr: string | null;
  readonly vatNumber: string | null;
  readonly crNumber: string | null;
  readonly crNumberScheme: string | null;
  readonly streetName: string | null;
  readonly additionalStreetName: string | null;
  readonly buildingNumber: string | null;
  readonly additionalNumber: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
  readonly missing: readonly string[];
  readonly complete: boolean;
  readonly locked: boolean;
}

export type ExpiryState = "OK" | "EXPIRING_SOON" | "EXPIRED";

export interface EgsUnitView {
  readonly id: string;
  readonly name: string;
  readonly serial: string;
  readonly branchName: string | null;
  readonly businessCategory: string;
  readonly invoiceTypes: string;
  readonly environment: ZatcaEnvironment;
  readonly status: string;
  readonly isActive: boolean;
  readonly credentialStatus: string | null;
  readonly certificateExpiresAt: string | null;
  readonly daysUntilExpiry: number | null;
  readonly expiry: ExpiryState | null;
  readonly lastRenewalAt: string | null;
  readonly lastIcv: string;
}

export interface OnboardingStepResult {
  readonly step: "COMPLIANCE_CSID" | "COMPLIANCE_CHECKS" | "PRODUCTION_CSID" | "RENEWAL";
  readonly ok: boolean;
  readonly egsStatus: string;
  readonly checks?: readonly { readonly label: string; readonly ok: boolean; readonly message?: string }[];
  readonly error?: { readonly code: string; readonly message: string; readonly status?: number };
}

export interface InvoiceRecordView {
  readonly salesInvoiceId: string;
  readonly status: string;
  readonly uuid: string;
  readonly icv: string;
  readonly attempts: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly hasSignedXml: boolean;
  readonly hasClearedXml: boolean;
  readonly qrCode: string | null;
  readonly environment: ZatcaEnvironment;
  readonly submittedAt: string | null;
  readonly clearedAt: string | null;
  readonly reportedAt: string | null;
  readonly canResubmit: boolean;
}

export interface ComplianceOverview {
  readonly environment: ZatcaEnvironment;
  readonly seller: SellerProfileView;
  readonly egsUnits: readonly EgsUnitView[];
  readonly capabilities: { readonly resubmit: boolean };
}

export function useComplianceOverview() {
  const { can } = usePermissions();
  return useQuery({ queryKey: ["compliance", "overview"], queryFn: async () => (await apiClient.get<ComplianceOverview>("/v1/compliance/overview")).data, enabled: can("compliance:read") });
}

export function useEgsUnit(id: string | undefined) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["compliance", "egsUnit", id],
    queryFn: async () => (await apiClient.get<EgsUnitView>(`/v1/compliance/egs-units/${id}`)).data,
    enabled: can("compliance:read") && id !== undefined,
  });
}

export interface SellerProfileInput {
  readonly vatNumber?: string;
  readonly crNumber?: string;
  readonly crNumberScheme?: string;
  readonly streetName?: string;
  readonly additionalStreetName?: string;
  readonly buildingNumber?: string;
  readonly additionalNumber?: string;
  readonly district?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly nameAr?: string;
  readonly phone?: string;
}

export function useUpdateSellerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SellerProfileInput) => (await apiClient.put<SellerProfileView>("/v1/compliance/seller-profile", input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

export interface CreateEgsUnitInput {
  readonly name: string;
  readonly branchName?: string;
  readonly businessCategory: string;
  readonly invoiceTypes: string;
}

export function useCreateEgsUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEgsUnitInput) => (await apiClient.post<EgsUnitView>("/v1/compliance/egs-units", input, { headers: { "Idempotency-Key": newId() } })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

function useOnboardingStep(segment: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { feedback: "dialog" },
    mutationFn: async ({ egsUnitId, otp }: { readonly egsUnitId: string; readonly otp?: string }) =>
      (await apiClient.post<OnboardingStepResult>(`/v1/compliance/egs-units/${egsUnitId}/onboarding/${segment}`, otp !== undefined ? { otp } : {}, { headers: { "Idempotency-Key": newId() } })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
  });
}

export const useStartOnboarding = () => useOnboardingStep("start");
export const useRunComplianceChecks = () => useOnboardingStep("compliance-checks");
export const useRequestProductionCsid = () => useOnboardingStep("production-csid");
export const useRenewCertificate = () => useOnboardingStep("renew");

export function useInvoiceRecord(salesInvoiceId: string | undefined) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["compliance", "invoice", salesInvoiceId],
    queryFn: async () => (await apiClient.get<InvoiceRecordView>(`/v1/compliance/invoices/${salesInvoiceId}`)).data,
    enabled: can("compliance:read") && salesInvoiceId !== undefined,
    retry: false, // a 404 (no ZATCA record yet) is a normal, expected state, not a transient failure
  });
}

export function useInvoiceStatuses(salesInvoiceIds: readonly string[]) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["compliance", "invoiceStatuses", [...salesInvoiceIds].sort()],
    queryFn: async () => (await apiClient.get<Record<string, { readonly status: string; readonly environment: ZatcaEnvironment }>>("/v1/compliance/invoices/statuses", { params: { ids: salesInvoiceIds.join(",") } })).data,
    enabled: can("compliance:read") && salesInvoiceIds.length > 0,
  });
}

export function useResubmitInvoice() {
  const qc = useQueryClient();
  return useMutation({
    meta: { successKey: "feedback.submitted" },
    mutationFn: async (salesInvoiceId: string) => (await apiClient.post<InvoiceRecordView>(`/v1/compliance/invoices/${salesInvoiceId}/resubmit`, {}, { headers: { "Idempotency-Key": newId() } })).data,
    onSuccess: (_data, salesInvoiceId) => void qc.invalidateQueries({ queryKey: ["compliance", "invoice", salesInvoiceId] }),
  });
}
