import type { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import type { IAuditLogger } from "../contracts.js";
import type { DraftActor } from "../documents/document-draft.service.js";

export class CompanySettingsError extends Error {}
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: IAuditLogger,
  ) {}
  async get(companyId: string) {
    const [company, credentials, years] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, nameAr: true, version: true, defaultCurrency: true },
      }),
      this.prisma.egsCredential.count({ where: { companyId, status: { notIn: ["NEW"] } } }),
      this.prisma.fiscalYear.findMany({
        where: { companyId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      }),
    ]);
    return { ...company, identityLocked: credentials > 0, years };
  }
  async rename(
    input: { name: string; nameAr: string | null; version: number },
    actor: DraftActor,
    correlationId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
      const before = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
      if (before.version !== input.version) throw new CompanySettingsError("SETTINGS_CONFLICT");
      const name = input.name.trim(),
        nameAr = input.nameAr?.trim() || null;
      if (!name || name.length > 200 || (nameAr?.length ?? 0) > 200)
        throw new CompanySettingsError("INVALID_NAME");
      if (
        (name !== before.name || nameAr !== before.nameAr) &&
        (await tx.egsCredential.count({
          where: { companyId: actor.companyId, status: { notIn: ["NEW"] } },
        }))
      )
        throw new CompanySettingsError("IDENTITY_LOCKED");
      await tx.company.update({
        where: { id: actor.companyId },
        data: { name, nameAr, updatedBy: actor.id, version: { increment: 1 } },
      });
    });
    await this.audit.log({
      actorId: actor.id,
      action: "company.renamed",
      entityType: "Company",
      entityId: actor.companyId,
      correlationId,
    });
    return this.get(actor.companyId);
  }
  /** Tier 1's existing Gregorian year / monthly period convention, not year-end closing. */
  async addCalendarYear(year: number, actor: DraftActor, correlationId: string) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200)
      throw new CompanySettingsError("INVALID_YEAR");
    const startDate = new Date(Date.UTC(year, 0, 1)),
      endDate = new Date(Date.UTC(year, 11, 31)),
      id = newId();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
      if (
        await tx.fiscalYear.count({
          where: {
            companyId: actor.companyId,
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        })
      )
        throw new CompanySettingsError("YEAR_OVERLAP");
      await tx.fiscalYear.create({
        data: {
          id,
          companyId: actor.companyId,
          name: `FY${year}`,
          startDate,
          endDate,
          periods: {
            create: Array.from({ length: 12 }, (_, month) => ({
              id: newId(),
              companyId: actor.companyId,
              periodNumber: month + 1,
              startDate: new Date(Date.UTC(year, month, 1)),
              endDate: new Date(Date.UTC(year, month + 1, 0)),
            })),
          },
        },
      });
    });
    await this.audit.log({
      actorId: actor.id,
      action: "fiscal_year.created",
      entityType: "FiscalYear",
      entityId: id,
      after: { year, periodCount: 12 },
      correlationId,
    });
    return this.get(actor.companyId);
  }
}
