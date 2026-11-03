import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";

// The allowances a company pays. REVIEW: the two flags decide what GOSI and the end-of-service gratuity are computed on.
// The defaults for a new type (not in the GOSI base, in the end-of-service base) follow the rule already in force for the old
// "other allowances" field (Osama, 18 Oct 2026); whether each common allowance really belongs in either base is a question
// for an accountant and a labour-law adviser. The company can change both flags per type.

export class AllowanceTypeError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "NOT_FOUND" | "IN_USE",
    message: string,
  ) {
    super(message);
    this.name = "AllowanceTypeError";
  }
}

export interface AllowanceTypeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly isHousing: boolean;
  readonly inGosiBase: boolean;
  readonly inEosbBase: boolean;
  readonly isActive: boolean;
}

export interface CreateAllowanceTypeInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly isHousing?: boolean | undefined;
  readonly inGosiBase?: boolean | undefined;
  readonly inEosbBase?: boolean | undefined;
}

// The code and the housing marker never change after creation: the code identifies the type, and the housing marker decides
// which WPS column an amount is reported in, so flipping it would silently change a file already built the other way.
export interface UpdateAllowanceTypeInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly inGosiBase?: boolean | undefined;
  readonly inEosbBase?: boolean | undefined;
  readonly isActive?: boolean | undefined;
}

export interface AllowanceTypeActor {
  readonly id: string;
  readonly companyId: string;
}

const SELECT = { id: true, code: true, name: true, nameAr: true, isHousing: true, inGosiBase: true, inEosbBase: true, isActive: true } as const;

// The common allowances offered by the "add the usual types" button. Never created silently (like tax codes): the company
// chooses to add them.
export const COMMON_ALLOWANCE_TYPES: readonly { readonly code: string; readonly name: string; readonly nameAr: string; readonly isHousing: boolean }[] = [
  { code: "HOUSING", name: "Housing allowance", nameAr: "بدل السكن", isHousing: true },
  { code: "TRANSPORT", name: "Transport allowance", nameAr: "بدل النقل", isHousing: false },
  { code: "FOOD", name: "Food allowance", nameAr: "بدل الطعام", isHousing: false },
  { code: "PHONE", name: "Phone allowance", nameAr: "بدل الهاتف", isHousing: false },
  { code: "NATURE_OF_WORK", name: "Nature of work allowance", nameAr: "بدل طبيعة العمل", isHousing: false },
  { code: "TRAVEL", name: "Travel allowance", nameAr: "بدل السفر", isHousing: false },
  { code: "COST_OF_LIVING", name: "Cost of living allowance", nameAr: "بدل غلاء المعيشة", isHousing: false },
];

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export class AllowanceTypeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, includeInactive = false): Promise<readonly AllowanceTypeSummary[]> {
    return this.prisma.allowanceType.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: [{ isHousing: "desc" }, { name: "asc" }],
    });
  }

  async create(input: CreateAllowanceTypeInput, actor: AllowanceTypeActor, correlationId: string): Promise<AllowanceTypeSummary> {
    const code = input.code.trim().toUpperCase();
    const duplicate = await this.prisma.allowanceType.findUnique({ where: { companyId_code: { companyId: actor.companyId, code } }, select: { id: true } });
    if (duplicate) throw new AllowanceTypeError("DUPLICATE_CODE", "An allowance type with this code already exists");
    const id = newId();
    const created = await this.prisma.allowanceType.create({
      data: {
        id,
        companyId: actor.companyId,
        code,
        name: input.name.trim(),
        nameAr: blankToNull(input.nameAr),
        isHousing: input.isHousing ?? false,
        inGosiBase: input.inGosiBase ?? false,
        inEosbBase: input.inEosbBase ?? true,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: SELECT,
    });
    await this.audit.log({ actorId: actor.id, action: "allowance_type.created", entityType: "AllowanceType", entityId: id, after: { ...created }, correlationId });
    return created;
  }

  // Adds the usual types the company does not have yet (by code). Safe to repeat.
  async addCommon(actor: AllowanceTypeActor, correlationId: string): Promise<{ readonly added: number }> {
    const existing = new Set((await this.prisma.allowanceType.findMany({ where: { companyId: actor.companyId }, select: { code: true } })).map((t) => t.code));
    let added = 0;
    for (const common of COMMON_ALLOWANCE_TYPES) {
      if (existing.has(common.code)) continue;
      // Housing counts in the GOSI base (the rule already in force); every other common type defaults to out of it.
      await this.create({ code: common.code, name: common.name, nameAr: common.nameAr, isHousing: common.isHousing, inGosiBase: common.isHousing, inEosbBase: true }, actor, correlationId);
      added += 1;
    }
    return { added };
  }

  async update(id: string, input: UpdateAllowanceTypeInput, actor: AllowanceTypeActor, correlationId: string): Promise<AllowanceTypeSummary> {
    const before = await this.prisma.allowanceType.findFirst({ where: { id, companyId: actor.companyId }, select: SELECT });
    if (!before) throw new AllowanceTypeError("NOT_FOUND", "Allowance type not found");

    // A type that an active employee is paid cannot be stopped: payroll would keep paying it with no way to see or edit it.
    if (input.isActive === false && before.isActive) {
      const paid = await this.prisma.employeeAllowance.count({ where: { companyId: actor.companyId, allowanceTypeId: id, employee: { isActive: true } } });
      if (paid > 0) throw new AllowanceTypeError("IN_USE", `${paid} active employee(s) are paid this allowance; remove it from them first`);
    }

    const after = await this.prisma.allowanceType.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: blankToNull(input.nameAr) } : {}),
        ...(input.inGosiBase !== undefined ? { inGosiBase: input.inGosiBase } : {}),
        ...(input.inEosbBase !== undefined ? { inEosbBase: input.inEosbBase } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: SELECT,
    });
    await this.audit.log({ actorId: actor.id, action: "allowance_type.updated", entityType: "AllowanceType", entityId: id, before: { ...before }, after: { ...after }, correlationId });
    return after;
  }
}
