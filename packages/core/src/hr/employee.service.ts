import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import { allocateRef } from "../reference.js";

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
  };
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
    const row = await this.prisma.$transaction(async (tx) => {
      const ref = await allocateRef(tx, actor.companyId, "employee");
      return tx.employee.create({
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
    });

    const summary = toSummary(row);
    await this.audit.log({ actorId: actor.id, action: "employee.created", entityType: "Employee", entityId: id, after: { ...summary }, correlationId });
    return summary;
  }

  async update(id: string, input: UpdateEmployeeInput, actor: EmployeeActor, correlationId: string): Promise<EmployeeSummary | null> {
    const before = await this.prisma.employee.findFirst({ where: { id, companyId: actor.companyId }, select: EMPLOYEE_SELECT });
    if (!before) return null;

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
