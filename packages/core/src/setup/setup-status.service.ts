import type { PrismaClient } from "@erp/db";
import { ACCOUNT_MAPPING_KEYS } from "../inventory/account-mapping.service.js";

// What a new installation still needs before it can be used for real work, in the order to do it. `required` steps block posting;
// the others unlock a module (payroll, approvals) and can wait. Counts only, no business data.

export interface SetupStep {
  readonly key: "ACCOUNT_MAPPINGS" | "TAX_CODES" | "WAREHOUSE" | "FISCAL_YEAR" | "COMPANY_LOGO" | "ALLOWANCE_TYPES" | "EMPLOYEE_FOLDERS" | "WPS" | "APPROVAL_POLICY";
  readonly required: boolean;
  readonly done: boolean;
  // How far along it is, where that is a number (for example 9 of 15 accounts mapped).
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly link: string;
}

export interface SetupStatus {
  readonly steps: readonly SetupStep[];
  readonly requiredDone: boolean;
}

// The mapping keys every company needs. The three per-employee folders are optional (without them payroll uses the company-wide accounts).
const REQUIRED_KEYS = ACCOUNT_MAPPING_KEYS.filter((k) => !k.startsWith("EMPLOYEE_"));
const EMPLOYEE_KEYS = ACCOUNT_MAPPING_KEYS.filter((k) => k.startsWith("EMPLOYEE_"));

export class SetupStatusService {
  constructor(private readonly prisma: PrismaClient) {}

  async status(companyId: string): Promise<SetupStatus> {
    const [mapped, taxCodes, warehouses, nextYear, company, allowanceTypes, approvals] = await Promise.all([
      this.prisma.accountMapping.findMany({ where: { companyId }, select: { key: true } }),
      this.prisma.taxCode.count({ where: { companyId, isActive: true } }),
      this.prisma.warehouse.count({ where: { companyId, isActive: true } }),
      this.prisma.fiscalYear.count({ where: { companyId, startDate: { gt: new Date() } } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { wpsBankSarieId: true, wpsBankAccountNumber: true, wpsMolEstablishmentId: true } }),
      this.prisma.allowanceType.count({ where: { companyId, isActive: true } }),
      this.prisma.approvalPolicy.count({ where: { companyId } }),
    ]);
    const keys = new Set(mapped.map((m) => m.key));
    const requiredMapped = REQUIRED_KEYS.filter((k) => keys.has(k)).length;
    const employeeMapped = EMPLOYEE_KEYS.filter((k) => keys.has(k)).length;
    const logo = await this.prisma.attachment.count({ where: { companyId, ownerType: "COMPANY_LOGO" } }).catch(() => 0);
    const wps = Boolean(company?.wpsBankSarieId && company.wpsBankAccountNumber && company.wpsMolEstablishmentId);

    const steps: SetupStep[] = [
      { key: "ACCOUNT_MAPPINGS", required: true, done: requiredMapped === REQUIRED_KEYS.length, progress: { done: requiredMapped, total: REQUIRED_KEYS.length }, link: "/settings/account-mapping" },
      { key: "TAX_CODES", required: true, done: taxCodes > 0, progress: null, link: "/settings/tax-codes" },
      { key: "WAREHOUSE", required: true, done: warehouses > 0, progress: null, link: "/inventory/warehouses" },
      { key: "FISCAL_YEAR", required: false, done: nextYear > 0, progress: null, link: "/settings/company" },
      { key: "COMPANY_LOGO", required: false, done: logo > 0, progress: null, link: "/settings/company" },
      { key: "ALLOWANCE_TYPES", required: false, done: allowanceTypes > 0, progress: null, link: "/hr/allowance-types" },
      { key: "EMPLOYEE_FOLDERS", required: false, done: employeeMapped === EMPLOYEE_KEYS.length, progress: { done: employeeMapped, total: EMPLOYEE_KEYS.length }, link: "/settings/account-mapping" },
      { key: "WPS", required: false, done: wps, progress: null, link: "/hr/payroll-runs" },
      { key: "APPROVAL_POLICY", required: false, done: approvals > 0, progress: null, link: "/settings/approvals" },
    ];
    return { steps, requiredDone: steps.filter((s) => s.required).every((s) => s.done) };
  }
}
