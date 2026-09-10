import { newId } from "@erp/shared";
import type { INumberingService, NumberingContext, TransactionClient } from "../contracts.js";

// The ONLY implementation of INumberingService — docs/02-ARCHITECTURE-RULES.md §3.3.
// Gapless per (company, document type, fiscal year): allocation happens inside the
// caller's transaction using a row lock, so a rollback never burns a number and two
// concurrent requests can never receive the same one.
export class PrismaNumberingService implements INumberingService {
  async next(documentType: string, context: NumberingContext, tx: TransactionClient): Promise<string> {
    // Row lock via raw SQL — Prisma's query builder has no SELECT ... FOR UPDATE.
    // Parameterised, never string-interpolated (docs/04-DATA-MODEL-RULES.md §8).
    const locked = await tx.$queryRaw<
      { id: string; prefix: string; padding: number; last_number: number }[]
    >`
      SELECT id, prefix, padding, last_number
      FROM document_number_series
      WHERE company_id = ${context.companyId}
        AND document_type = ${documentType}
        AND fiscal_year = ${context.fiscalYear}
      FOR UPDATE
    `;

    let row = locked[0];
    if (!row) {
      // First document of this type for this company/fiscal-year — create the
      // series row now, still inside the same transaction and lock scope.
      const created = await tx.documentNumberSeries.create({
        data: {
          id: newId(),
          companyId: context.companyId,
          documentType,
          fiscalYear: context.fiscalYear,
          lastNumber: 0,
        },
      });
      row = { id: created.id, prefix: created.prefix, padding: created.padding, last_number: 0 };
    }

    const nextNumber = row.last_number + 1;
    await tx.documentNumberSeries.update({
      where: { id: row.id },
      data: { lastNumber: nextNumber },
    });

    return `${row.prefix}${String(nextNumber).padStart(row.padding, "0")}`;
  }
}
