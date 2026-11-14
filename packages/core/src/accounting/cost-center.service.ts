import { Prisma, type PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { PrismaAuditLogger } from "../audit/audit-logger.js";

export interface CostCenterInput {
  code: string;
  name: string;
  nameAr?: string;
  kind: "COST_CENTER" | "PROJECT" | "DEPARTMENT";
  isActive: boolean;
}

export class CostCenterError extends Error {
  constructor(readonly code: "COST_CENTER_NOT_FOUND" | "COST_CENTER_DUPLICATE" | "COST_CENTER_INVALID") { super(code); }
}

export class CostCenterService {
  constructor(private readonly prisma: PrismaClient) {}

  list(companyId: string) {
    return this.prisma.costCenter.findMany({ where: { companyId }, orderBy: { code: "asc" } });
  }

  async save(input: CostCenterInput, actor: { id: string; companyId: string }, correlationId: string, id?: string) {
    const data = { code: input.code.trim(), name: input.name.trim(), nameAr: input.nameAr?.trim() || null, kind: input.kind, isActive: input.isActive };
    if (!data.code || !data.name || !["COST_CENTER", "PROJECT", "DEPARTMENT"].includes(data.kind)) throw new CostCenterError("COST_CENTER_INVALID");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.costCenter.findFirst({ where: { id, companyId: actor.companyId } }) : null;
        if (id && !before) throw new CostCenterError("COST_CENTER_NOT_FOUND");
        const saved = id
          ? await tx.costCenter.update({ where: { id, companyId: actor.companyId }, data })
          : await tx.costCenter.create({ data: { ...data, id: newId(), companyId: actor.companyId } });
        await new PrismaAuditLogger(tx).log({ actorId: actor.id, action: id ? "cost_center.updated" : "cost_center.created", entityType: "CostCenter", entityId: saved.id, correlationId,
          ...(before ? { before: { code: before.code, name: before.name, nameAr: before.nameAr, kind: before.kind, isActive: before.isActive } } : {}), after: data });
        return saved;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CostCenterError("COST_CENTER_DUPLICATE");
      throw error;
    }
  }
}
