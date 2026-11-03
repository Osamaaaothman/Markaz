import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";
import { EmployeeAccountsError, loadParentGroups, provisionEmployeeAccounts, type CreatedLedgerRecord, type EmployeeForAccounts } from "./employee-accounts.js";
import { outstandingAdvanceTotal } from "./salary-advance-balance.js";

export class EmployeeError extends Error {
  constructor(
    readonly code: "OUTSTANDING_ADVANCES" | "ACCOUNTS_PARENTS_INCOMPLETE" | "ACCOUNTS_PARENTS_NOT_MAPPED" | "ACCOUNTS_PARENT_INVALID" | "ACCOUNTS_CODE_EXHAUSTED",
    message: string,
  ) {
    super(message);
    this.name = "EmployeeError";
  }
}

export interface EmployeeLedgerAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
}

// The employee's own accounts; null for an employee who has none (created before this existed, or in a company that has not
// set the three parent groups). Payroll and advances then use the company-wide accounts.
export interface EmployeeAccounts {
  readonly partyId: string;
  readonly advance: EmployeeLedgerAccount;
  readonly salaryPayable: EmployeeLedgerAccount;
  readonly eosb: EmployeeLedgerAccount;
}

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
  readonly accounts: EmployeeAccounts | null;
}

export interface EmployeeListQuery {
  readonly cursor?: string | undefined;
  readonly limit?: string | undefined;
  readonly q?: string | undefined;
  readonly includeInactive?: "true" | "false" | undefined;
}

export interface EmployeeListPage {
  readonly data: readonly EmployeeSummary[];
  readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface CreateEmployeeInput {
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly nationalId: string;
  readonly isSaudi: boolean;
  readonly gosiLegacyTrack?: boolean | undefined;
  readonly bankIban: string;
  readonly bankName?: string | null | undefined;
  readonly hireDate: Date;
  readonly basicSalary: string;
  readonly housingAllowance?: string | undefined;
  readonly otherAllowances?: string | undefined;
}

// A field left out (undefined) is kept; null or "" clears an optional detail.
export interface UpdateEmployeeInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly isSaudi?: boolean | undefined;
  readonly gosiLegacyTrack?: boolean | undefined;
  readonly bankIban?: string | undefined;
  readonly bankName?: string | null | undefined;
  readonly basicSalary?: string | undefined;
  readonly housingAllowance?: string | undefined;
  readonly otherAllowances?: string | undefined;
  readonly terminationDate?: Date | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface EmployeeActor {
  readonly id: string;
  readonly companyId: string;
}

const EMPLOYEE_SELECT = {
  id: true,
  ref: true,
  name: true,
  nameAr: true,
  nationalId: true,
  isSaudi: true,
  gosiLegacyTrack: true,
  bankIban: true,
  bankName: true,
  hireDate: true,
  terminationDate: true,
  basicSalary: true,
  housingAllowance: true,
  otherAllowances: true,
  isActive: true,
  partyId: true,
  advanceAccount: { select: { id: true, code: true, name: true, nameAr: true } },
  salaryPayableAccount: { select: { id: true, code: true, name: true, nameAr: true } },
  eosbAccount: { select: { id: true, code: true, name: true, nameAr: true } },
} as const;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Row = {
  id: string;
  ref: string;
  name: string;
  nameAr: string | null;
  nationalId: string;
  isSaudi: boolean;
  gosiLegacyTrack: boolean;
  bankIban: string;
  bankName: string | null;
  hireDate: Date;
  terminationDate: Date | null;
  basicSalary: { toFixed(n: number): string };
  housingAllowance: { toFixed(n: number): string };
  otherAllowances: { toFixed(n: number): string };
  isActive: boolean;
  partyId: string | null;
  advanceAccount: EmployeeLedgerAccount | null;
  salaryPayableAccount: EmployeeLedgerAccount | null;
  eosbAccount: EmployeeLedgerAccount | null;
};

function toSummary(row: Row): EmployeeSummary {
  return {
    id: row.id,
    ref: row.ref,
    name: row.name,
    nameAr: row.nameAr,
    nationalId: row.nationalId,
    isSaudi: row.isSaudi,
    gosiLegacyTrack: row.gosiLegacyTrack,
    bankIban: row.bankIban,
    bankName: row.bankName,
    hireDate: dateOnly(row.hireDate),
    terminationDate: row.terminationDate ? dateOnly(row.terminationDate) : null,
    basicSalary: row.basicSalary.toFixed(4),
    housingAllowance: row.housingAllowance.toFixed(4),
    otherAllowances: row.otherAllowances.toFixed(4),
    isActive: row.isActive,
    accounts:
      row.partyId && row.advanceAccount && row.salaryPayableAccount && row.eosbAccount
        ? { partyId: row.partyId, advance: row.advanceAccount, salaryPayable: row.salaryPayableAccount, eosb: row.eosbAccount }
        : null,
  };
}

function accountsError(error: unknown): never {
  if (!(error instanceof EmployeeAccountsError)) throw error;
  const code = { PARENTS_INCOMPLETE: "ACCOUNTS_PARENTS_INCOMPLETE", PARENTS_NOT_MAPPED: "ACCOUNTS_PARENTS_NOT_MAPPED", PARENT_INVALID: "ACCOUNTS_PARENT_INVALID", CODE_EXHAUSTED: "ACCOUNTS_CODE_EXHAUSTED" } as const;
  throw new EmployeeError(code[error.code], error.message);
}

// The employee master. Framework-free like every other core service -- the API wraps it and maps
// a null result to HTTP 404. Salary structure lives on the row itself (basic/housing/other),
// not a separate table: one known use today does not justify an extra join, docs/00 §7.
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, query: EmployeeListQuery): Promise<EmployeeListPage> {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 100);
    const q = query.q?.trim();

    const rows = await this.prisma.employee.findMany({
      where: {
        companyId,
        ...(query.includeInactive === "true" ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { nameAr: { contains: q, mode: "insensitive" } },
                { nationalId: { contains: q } },
                { ref: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: EMPLOYEE_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { data: page.map(toSummary), pageInfo: { hasMore, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null } };
  }

  async get(id: string, companyId: string): Promise<EmployeeSummary | null> {
    const row = await this.prisma.employee.findFirst({ where: { id, companyId }, select: EMPLOYEE_SELECT });
    return row ? toSummary(row) : null;
  }

  async create(input: CreateEmployeeInput, actor: EmployeeActor, correlationId: string): Promise<EmployeeSummary> {
    const id = newId();
    let createdRecords: readonly CreatedLedgerRecord[] = [];
    const row = await this.prisma.$transaction(async (tx) => {
      // If the three parent groups are set, the employee is given a party and three accounts in this same transaction, so
      // an employee never exists half-provisioned; if none is set, the employee is created without them (see
      // EmployeeSummary.accounts). A half-set mapping is refused.
      const parents = await loadParentGroups(tx, actor.companyId).catch(accountsError);
      const ref = await allocateRef(tx, actor.companyId, "employee");
      const created = await tx.employee.create({
        data: {
          id,
          ref,
          companyId: actor.companyId,
          name: input.name.trim(),
          nameAr: blankToNull(input.nameAr),
          nationalId: input.nationalId.trim(),
          isSaudi: input.isSaudi,
          gosiLegacyTrack: input.gosiLegacyTrack ?? false,
          bankIban: input.bankIban.trim().toUpperCase(),
          bankName: blankToNull(input.bankName),
          hireDate: input.hireDate,
          basicSalary: input.basicSalary,
          housingAllowance: input.housingAllowance ?? "0",
          otherAllowances: input.otherAllowances ?? "0",
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: EMPLOYEE_SELECT,
      });
      if (!parents) return created;
      const provisioned = await provisionEmployeeAccounts(tx, actor.companyId, actor.id, { id, name: created.name, nameAr: created.nameAr, partyId: null, advanceAccountId: null, salaryPayableAccountId: null, eosbAccountId: null }, parents).catch(accountsError);
      createdRecords = provisioned.created;
      return tx.employee.update({ where: { id }, data: provisioned.ids, select: EMPLOYEE_SELECT });
    });

    const summary = toSummary(row);
    await this.audit.log({ actorId: actor.id, action: "employee.created", entityType: "Employee", entityId: id, after: { ...summary }, correlationId });
    await this.auditCreated(createdRecords, actor.id, correlationId);
    return summary;
  }

  private async auditCreated(records: readonly CreatedLedgerRecord[], actorId: string, correlationId: string): Promise<void> {
    for (const record of records) {
      await this.audit.log({ actorId, action: record.entityType === "Party" ? "party.created" : "account.created", entityType: record.entityType, entityId: record.id, after: { label: record.label, source: "employee" }, correlationId });
    }
  }

  // Gives one employee the party and accounts they are missing, under the three mapped parent groups. For employees created
  // before per-employee accounts existed, or before the groups were set. Nothing posted so far is moved: what an employee
  // already owes or is owed stays on the company-wide accounts, and an advance keeps the account it was granted on.
  async provisionAccounts(id: string, actor: EmployeeActor, correlationId: string): Promise<EmployeeSummary | null> {
    let createdRecords: readonly CreatedLedgerRecord[] = [];
    const row = await this.prisma.$transaction(async (tx) => {
      const parents = await loadParentGroups(tx, actor.companyId).catch(accountsError);
      if (!parents) throw new EmployeeError("ACCOUNTS_PARENTS_NOT_MAPPED", "Set the three employee account groups in the account mapping first");
      const employee = await tx.employee.findFirst({ where: { id, companyId: actor.companyId }, select: { id: true, name: true, nameAr: true, partyId: true, advanceAccountId: true, salaryPayableAccountId: true, eosbAccountId: true } });
      if (!employee) return null;
      const provisioned = await provisionEmployeeAccounts(tx, actor.companyId, actor.id, employee satisfies EmployeeForAccounts, parents).catch(accountsError);
      createdRecords = provisioned.created;
      if (provisioned.created.length === 0) return tx.employee.findFirst({ where: { id }, select: EMPLOYEE_SELECT });
      return tx.employee.update({ where: { id }, data: { ...provisioned.ids, updatedBy: actor.id, version: { increment: 1 } }, select: EMPLOYEE_SELECT });
    });
    if (!row) return null;
    const summary = toSummary(row);
    if (createdRecords.length > 0) {
      await this.audit.log({ actorId: actor.id, action: "employee.accounts_created", entityType: "Employee", entityId: id, after: { accounts: summary.accounts?.partyId ?? null }, correlationId });
      await this.auditCreated(createdRecords, actor.id, correlationId);
    }
    return summary;
  }

  // The same for every active employee who lacks any of the four. One transaction per employee, so one failure (for example
  // a parent group that has run out of codes) leaves the others done and is reported by employee.
  async provisionMissingAccounts(actor: EmployeeActor, correlationId: string): Promise<{ readonly provisioned: number; readonly failed: readonly { readonly ref: string; readonly code: string }[] }> {
    const missing = await this.prisma.employee.findMany({
      where: { companyId: actor.companyId, isActive: true, OR: [{ partyId: null }, { advanceAccountId: null }, { salaryPayableAccountId: null }, { eosbAccountId: null }] },
      select: { id: true, ref: true },
      orderBy: { ref: "asc" },
    });
    let provisioned = 0;
    const failed: { ref: string; code: string }[] = [];
    for (const employee of missing) {
      try {
        await this.provisionAccounts(employee.id, actor, correlationId);
        provisioned += 1;
      } catch (error) {
        if (error instanceof EmployeeError && (error.code === "ACCOUNTS_PARENTS_NOT_MAPPED" || error.code === "ACCOUNTS_PARENTS_INCOMPLETE" || error.code === "ACCOUNTS_PARENT_INVALID")) throw error;
        failed.push({ ref: employee.ref, code: error instanceof EmployeeError ? error.code : "UNEXPECTED" });
      }
    }
    return { provisioned, failed };
  }

  async update(id: string, input: UpdateEmployeeInput, actor: EmployeeActor, correlationId: string): Promise<EmployeeSummary | null> {
    const before = await this.prisma.employee.findFirst({ where: { id, companyId: actor.companyId }, select: EMPLOYEE_SELECT });
    if (!before) return null;

    // Stopping an employee by hand has the same rule as the end-of-service settlement: payroll stops recovering the
    // advances of an inactive employee, so what is still owed must be repaid first.
    if (input.isActive === false && before.isActive) {
      const owed = await outstandingAdvanceTotal(this.prisma, actor.companyId, id);
      if (owed.greaterThan(0)) throw new EmployeeError("OUTSTANDING_ADVANCES", `This employee still owes ${owed.toFixed(4)} on salary advances; repay them first`);
    }

    const after = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: blankToNull(input.nameAr) } : {}),
        ...(input.isSaudi !== undefined ? { isSaudi: input.isSaudi } : {}),
        ...(input.gosiLegacyTrack !== undefined ? { gosiLegacyTrack: input.gosiLegacyTrack } : {}),
        ...(input.bankIban !== undefined ? { bankIban: input.bankIban.trim().toUpperCase() } : {}),
        ...(input.bankName !== undefined ? { bankName: blankToNull(input.bankName) } : {}),
        ...(input.basicSalary !== undefined ? { basicSalary: input.basicSalary } : {}),
        ...(input.housingAllowance !== undefined ? { housingAllowance: input.housingAllowance } : {}),
        ...(input.otherAllowances !== undefined ? { otherAllowances: input.otherAllowances } : {}),
        ...(input.terminationDate !== undefined ? { terminationDate: input.terminationDate } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: EMPLOYEE_SELECT,
    });

    const afterSummary = toSummary(after);
    await this.audit.log({ actorId: actor.id, action: "employee.updated", entityType: "Employee", entityId: id, before: { ...toSummary(before) }, after: { ...afterSummary }, correlationId });
    return afterSummary;
  }

  // All active employees, for pickers (payroll run, salary advance). No pagination -- company
  // headcounts in this tier are small, same reasoning as useAllItems/useAllWarehouses in the web app.
  async listAllActive(companyId: string): Promise<readonly EmployeeSummary[]> {
    const rows = await this.prisma.employee.findMany({ where: { companyId, isActive: true }, select: EMPLOYEE_SELECT, orderBy: { name: "asc" } });
    return rows.map(toSummary);
  }
}
