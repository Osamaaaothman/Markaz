import { newId } from "@erp/shared";
import type { TransactionClient } from "./contracts.js";
import { PrismaNumberingService } from "./accounting/numbering.service.js";

// Human-readable references for master data (USR-000012, ROL-000003, PRT-000041, ACC-000217).
// The UUID primary key stays the real key; a `ref` is a per-company label people can read out
// and search by. Numbers come from the same gapless `document_number_series` table as document
// numbers (document type REF_<PREFIX>, fiscal year "ALL" — master data does not restart yearly),
// so an allocation rolled back with its transaction never burns a number.
export const REF_PREFIXES = {
  user: "USR",
  role: "ROL",
  party: "PRT",
  account: "ACC",
} as const;

export type RefKind = keyof typeof REF_PREFIXES;

const REF_PADDING = 6;
const REF_FISCAL_YEAR_KEY = "ALL";
const numbering = new PrismaNumberingService();

// Allocates the next reference for `kind` inside the caller's transaction. Call it in the same
// transaction that creates the row, and pass the result as the row's `ref`.
export async function allocateRef(tx: TransactionClient, companyId: string, kind: RefKind): Promise<string> {
  const prefix = REF_PREFIXES[kind];
  const documentType = `REF_${prefix}`;

  // The numbering service creates a missing series row with no prefix; make sure this one
  // exists with its prefix first. Concurrent creators race harmlessly (DO NOTHING).
  await tx.$executeRaw`
    INSERT INTO document_number_series (id, company_id, document_type, fiscal_year, prefix, padding, last_number, updated_at)
    VALUES (${newId()}, ${companyId}, ${documentType}, ${REF_FISCAL_YEAR_KEY}, ${`${prefix}-`}, ${REF_PADDING}, 0, now())
    ON CONFLICT (company_id, document_type, fiscal_year) DO NOTHING
  `;

  return numbering.next(documentType, { companyId, fiscalYear: REF_FISCAL_YEAR_KEY }, tx);
}
