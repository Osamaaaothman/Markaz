import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";

export const TAX_TREATMENTS = ["STANDARD", "ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export class TaxCodeError extends Error {
  constructor(
    readonly code: "DUPLICATE_CODE" | "TAX_CODE_NOT_FOUND" | "INVALID_RATE",
    message: string,
  ) {
    super(message);
    this.name = "TaxCodeError";
  }
}

export interface TaxCodeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly rate: string;
  readonly treatment: TaxTreatment;
  readonly isActive: boolean;
}

export interface CreateTaxCodeInput {
  readonly code: string;
  readonly name: string;
  readonly nameAr?: string | null | undefined;
  readonly rate: string;
  readonly treatment: TaxTreatment;
}

export interface UpdateTaxCodeInput {
  readonly name?: string | undefined;
  readonly nameAr?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface TaxCodeActor {
  readonly id: string;
  readonly companyId: string;
}

const TAX_CODE_SELECT = { id: true, code: true, name: true, nameAr: true, rate: true, treatment: true, isActive: true } as const;

function toSummary(row: {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  rate: Prisma.Decimal;
  treatment: string;
  isActive: boolean;
}): TaxCodeSummary {
  return { ...row, rate: row.rate.toFixed(4), treatment: row.treatment as TaxTreatment };
}

// The Saudi VAT treatments, offered as a one-click starting point rather than seeded silently: a tax
// rule belongs to the company that owns the books, and its accountant confirms it. 15% is the
// standard rate in force (ZATCA VAT guidelines); zero-rated, exempt and out-of-scope are the other
// treatments an invoice line can carry.
export const SAUDI_DEFAULT_TAX_CODES: readonly CreateTaxCodeInput[] = [
  { code: "VAT15", name: "VAT 15% (standard)", nameAr: "ضريبة القيمة المضافة 15% (أساسية)", rate: "15", treatment: "STANDARD" },
  { code: "VAT0", name: "VAT 0% (zero-rated)", nameAr: "ضريبة القيمة المضافة 0% (نسبة صفرية)", rate: "0", treatment: "ZERO_RATED" },
  { code: "EXEMPT", name: "VAT exempt", nameAr: "معفى من الضريبة", rate: "0", treatment: "EXEMPT" },
  { code: "OUT_OF_SCOPE", name: "Outside the scope of VAT", nameAr: "خارج نطاق الضريبة", rate: "0", treatment: "OUT_OF_SCOPE" },
];

// A code's rate and treatment never change after creation: invoice lines copy them when posted, and
// a changed rate on an old code would make history look like it was taxed differently. A different
// rate is a new code; the old one is deactivated.
export class TaxCodeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}

  async list(companyId: string, includeInactive: boolean): Promise<TaxCodeSummary[]> {
    const rows = await this.prisma.taxCode.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      select: TAX_CODE_SELECT,
      orderBy: [{ code: "asc" }],
    });
    return rows.map(toSummary);
  }

  async create(input: CreateTaxCodeInput, actor: TaxCodeActor, correlationId: string): Promise<TaxCodeSummary> {
    const rate = new Prisma.Decimal(input.rate);
    if (rate.lessThan(0) || rate.greaterThan(100)) throw new TaxCodeError("INVALID_RATE", "A rate is between 0 and 100");
    if (input.treatment !== "STANDARD" && !rate.isZero()) {
      throw new TaxCodeError("INVALID_RATE", "Only a standard-rated code carries a percentage");
    }
    const code = input.code.trim().toUpperCase();
    const duplicate = await this.prisma.taxCode.findUnique({
      where: { companyId_code: { companyId: actor.companyId, code } },
      select: { id: true },
    });
    if (duplicate) throw new TaxCodeError("DUPLICATE_CODE", "A tax code with this code already exists");

    const created = await this.prisma.taxCode.create({
      data: {
        id: newId(),
        companyId: actor.companyId,
        code,
        name: input.name.trim(),
        nameAr: input.nameAr?.trim() || null,
        rate,
        treatment: input.treatment,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: TAX_CODE_SELECT,
    });
    const summary = toSummary(created);
    await this.audit.log({ actorId: actor.id, action: "tax_code.created", entityType: "TaxCode", entityId: summary.id, after: { ...summary }, correlationId });
    return summary;
  }

  async update(id: string, input: UpdateTaxCodeInput, actor: TaxCodeActor, correlationId: string): Promise<TaxCodeSummary> {
    const before = await this.prisma.taxCode.findFirst({ where: { id, companyId: actor.companyId }, select: TAX_CODE_SELECT });
    if (!before) throw new TaxCodeError("TAX_CODE_NOT_FOUND", "Tax code not found");
    const after = await this.prisma.taxCode.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: actor.id,
        version: { increment: 1 },
      },
      select: TAX_CODE_SELECT,
    });
    await this.audit.log({
      actorId: actor.id,
      action: "tax_code.updated",
      entityType: "TaxCode",
      entityId: id,
      before: { ...toSummary(before) },
      after: { ...toSummary(after) },
      correlationId,
    });
    return toSummary(after);
  }

  // Adds whichever of the standard Saudi codes this company does not have yet. Safe to repeat.
  async addSaudiDefaults(actor: TaxCodeActor, correlationId: string): Promise<TaxCodeSummary[]> {
    const existing = new Set((await this.prisma.taxCode.findMany({ where: { companyId: actor.companyId }, select: { code: true } })).map((c) => c.code));
    for (const preset of SAUDI_DEFAULT_TAX_CODES) {
      if (!existing.has(preset.code)) await this.create(preset, actor, correlationId);
    }
    return this.list(actor.companyId, true);
  }
}
