import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { usePermissions } from "../../shared/auth/use-permissions";

// ── Employees ────────────────────────────────────────────────────────────────

export interface EmployeeSummary {
  readonly id: string;
  readonly ref: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly nationalId: string;
  readonly isSaudi: boolean;
  readonly gosiLegacyTrack: boolean;
  readonly bankIban: string;
  readonly bankName: string | null;
  readonly hireDate: string;
  readonly terminationDate: string | null;
  readonly basicSalary: string;
  readonly housingAllowance: string;
  readonly otherAllowances: string;
  readonly isActive: boolean;
  // What the employee is paid besides basic salary, one entry per allowance type.
  readonly allowances: readonly EmployeeAllowanceLine[];
  // The employee's own party and ledger accounts; null when they have none (payroll then uses the company-wide accounts).
  readonly accounts: EmployeeAccounts | null;
}

export interface EmployeeAllowanceLine {
  readonly allowanceTypeId: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly amount: string;
  readonly isHousing: boolean;
  readonly inGosiBase: boolean;
  readonly inEosbBase: boolean;
}

export interface AllowanceInput {
  readonly allowanceTypeId: string;
  readonly amount: string;
}

export interface EmployeeLedgerAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export interface EmployeeAccounts {
  readonly partyId: string;
  readonly advance: EmployeeLedgerAccount;
  readonly salaryPayable: EmployeeLedgerAccount;
  readonly eosb: EmployeeLedgerAccount;
}

interface EmployeeListPage {
  readonly data: readonly EmployeeSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface EmployeeFilter {
  readonly q: string;
  readonly includeInactive: boolean;
}

export interface CreateEmployeePayload {
  readonly name: string;
  readonly nameAr?: string;
  readonly nationalId: string;
  readonly isSaudi: boolean;
  readonly gosiLegacyTrack?: boolean;
  readonly bankIban: string;
  readonly bankName?: string;
  readonly hireDate: string;
  readonly basicSalary: string;
  readonly allowances?: readonly AllowanceInput[];
}

export interface UpdateEmployeePayload {
  readonly name?: string;
  readonly nameAr?: string | null;
  readonly isSaudi?: boolean;
  readonly gosiLegacyTrack?: boolean;
  readonly bankIban?: string;
  readonly bankName?: string | null;
  readonly basicSalary?: string;
  // Replaces the whole set; a type left out is removed.
  readonly allowances?: readonly AllowanceInput[];
  readonly isActive?: boolean;
}

function employeeListParams(filter: EmployeeFilter, cursor?: string): Record<string, string> {
  const q = filter.q.trim();
  return { limit: "50", ...(q ? { q } : {}), ...(filter.includeInactive ? { includeInactive: "true" } : {}), ...(cursor ? { cursor } : {}) };
}

export const employeeErrorCode = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code;

export function useEmployees(filter: EmployeeFilter) {
  const { can } = usePermissions();
  return useInfiniteQuery({
    queryKey: ["employees", "list", filter],
    queryFn: async ({ pageParam }) => (await apiClient.get<EmployeeListPage>("/v1/employees", { params: employeeListParams(filter, pageParam) })).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: can("employee:read"),
  });
}

export function useAllEmployees() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["employees", "all"],
    queryFn: async () => (await apiClient.get<EmployeeSummary[]>("/v1/employees/all")).data,
    staleTime: 30_000,
    enabled: can("employee:read"),
  });
}

export function useEmployee(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["employees", "detail", id],
    queryFn: async () => (await apiClient.get<EmployeeSummary>(`/v1/employees/${id}`)).data,
    enabled: can("employee:read") && id !== "",
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateEmployeePayload) => (await apiClient.post<EmployeeSummary>("/v1/employees", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

// Gives one employee the party and accounts they are missing.
export function useProvisionEmployeeAccounts(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<EmployeeSummary>(`/v1/employees/${employeeId}/accounts`, {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

// The same for every active employee who lacks them. `failed` lists employees it could not do (for example a group that ran out of codes).
export function useProvisionMissingEmployeeAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<{ provisioned: number; failed: { ref: string; code: string }[] }>("/v1/employees/accounts/provision-missing", {})).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useUpdateEmployee(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateEmployeePayload) => (await apiClient.put<EmployeeSummary>(`/v1/employees/${employeeId}`, payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

// ── Payroll runs ─────────────────────────────────────────────────────────────

export interface PayrollRunSummary {
  readonly id: string;
  readonly number: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly totalNet: string;
  readonly currency: string;
}

export interface PayrollRunLine {
  readonly employeeId: string;
  readonly employeeRef: string;
  readonly employeeName: string;
  readonly employeeNameAr: string | null;
  readonly nationalId: string;
  readonly bankIban: string;
  readonly basicSalary: string;
  readonly allowances: readonly { readonly name: string; readonly nameAr: string | null; readonly amount: string; readonly isHousing: boolean }[];
  readonly housingAllowance: string;
  readonly otherAllowances: string;
  readonly gross: string;
  readonly gosiEmployeeShare: string;
  readonly gosiEmployerShare: string;
  readonly advanceDeduction: string;
  readonly net: string;
}

export interface PayrollRunDetail {
  readonly id: string;
  readonly number: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
  readonly currency: string;
  readonly totalGross: string;
  readonly totalGosiEmployee: string;
  readonly totalGosiEmployer: string;
  readonly totalAdvanceDeduction: string;
  readonly totalNet: string;
  readonly journalEntryId: string;
  readonly lines: readonly PayrollRunLine[];
}

export interface CreatePayrollRunPayload {
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly runDate: string;
}

export function usePayrollRuns() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["payrollRuns", "list"],
    queryFn: async () => (await apiClient.get<PayrollRunSummary[]>("/v1/payroll-runs")).data,
    staleTime: 15_000,
    enabled: can("payroll_run:read"),
  });
}

export function usePayrollRun(id: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["payrollRuns", "detail", id],
    queryFn: async () => (await apiClient.get<PayrollRunDetail>(`/v1/payroll-runs/${id}`)).data,
    enabled: can("payroll_run:read") && id !== "",
  });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePayrollRunPayload) => {
      const idempotencyKey = crypto.randomUUID();
      return (await apiClient.post<{ id: string; number: string } & Record<string, unknown>>("/v1/payroll-runs", payload, { headers: { "Idempotency-Key": idempotencyKey } })).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payrollRuns"] });
      void qc.invalidateQueries({ queryKey: ["salaryAdvances"] });
      void qc.invalidateQueries({ queryKey: ["trialBalance"] });
    },
  });
}

// ── Salary advances ──────────────────────────────────────────────────────────

export interface SalaryAdvanceSummary {
  readonly id: string;
  readonly number: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly grantDate: string;
  readonly amount: string;
  readonly installmentAmount: string;
  readonly deducted: string;
  // Paid back directly (cash or bank), outside payroll.
  readonly repaid: string;
  readonly remaining: string;
}

export interface GrantSalaryAdvancePayload {
  readonly employeeId: string;
  readonly grantDate: string;
  readonly amount: string;
  readonly installmentAmount: string;
  readonly cashAccountId: string;
}

export function useSalaryAdvances(employeeId?: string) {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["salaryAdvances", employeeId ?? "all"],
    queryFn: async () => (await apiClient.get<SalaryAdvanceSummary[]>("/v1/salary-advances", { params: employeeId ? { employeeId } : {} })).data,
    staleTime: 15_000,
    enabled: can("salary_advance:read"),
  });
}

export function useGrantSalaryAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GrantSalaryAdvancePayload) => {
      const idempotencyKey = crypto.randomUUID();
      return (await apiClient.post<{ id: string; number: string }>("/v1/salary-advances", payload, { headers: { "Idempotency-Key": idempotencyKey } })).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["salaryAdvances"] });
      void qc.invalidateQueries({ queryKey: ["trialBalance"] });
    },
  });
}

export interface RepaySalaryAdvancePayload {
  readonly advanceId: string;
  readonly repaymentDate: string;
  readonly amount: string;
  readonly cashAccountId: string;
}

export function useRepaySalaryAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ advanceId, ...payload }: RepaySalaryAdvancePayload) =>
      (
        await apiClient.post<{ id: string; number: string; remaining: string }>(`/v1/salary-advances/${advanceId}/repayments`, payload, {
          headers: { "Idempotency-Key": crypto.randomUUID() },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["salaryAdvances"] });
      void qc.invalidateQueries({ queryKey: ["trialBalance"] });
      void qc.invalidateQueries({ queryKey: ["accountBalances"] });
    },
  });
}

// ── End of service ───────────────────────────────────────────────────────────

export type EndOfServiceReason = "RESIGNATION" | "TERMINATION" | "OTHER";

export interface SettleEndOfServicePayload {
  readonly employeeId: string;
  readonly terminationDate: string;
  readonly reason: EndOfServiceReason;
}

export interface EndOfServiceResult {
  readonly id: string;
  readonly number: string;
  readonly journalEntryId: string;
  readonly yearsOfService: string;
  readonly grossEntitlement: string;
  readonly entitlementFraction: string;
  readonly netEntitlement: string;
}

export function useSettleEndOfService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SettleEndOfServicePayload) => {
      const idempotencyKey = crypto.randomUUID();
      return (await apiClient.post<EndOfServiceResult>("/v1/end-of-service-settlements", payload, { headers: { "Idempotency-Key": idempotencyKey } })).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["trialBalance"] });
    },
  });
}

// ── WPS settings ─────────────────────────────────────────────────────────────

export interface WpsSettings {
  readonly bankSarieId: string | null;
  readonly bankAccountNumber: string | null;
  readonly molEstablishmentId: string | null;
  readonly isComplete: boolean;
}

export function useWpsSettings() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ["wpsSettings"],
    queryFn: async () => (await apiClient.get<WpsSettings>("/v1/company/wps-settings")).data,
    staleTime: 60_000,
    enabled: can("company:read"),
  });
}

export function useSetWpsSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { bankSarieId: string; bankAccountNumber: string; molEstablishmentId: string }) =>
      (await apiClient.put<WpsSettings>("/v1/company/wps-settings", payload)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wpsSettings"] }),
  });
}
