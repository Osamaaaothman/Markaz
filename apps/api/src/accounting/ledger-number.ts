import type { PrismaClient } from "@erp/db";

// The Journal Entries register's "#" column needs a number that is unique across the
// WHOLE register. `journal_entries.number` cannot serve that role: it is the source
// document's own number (docs/01-OPEN-DECISIONS.md §L), gapless only within its own
// (company, documentType, fiscalYear) series — two entries from different modules
// routinely land on the same `number`.
//
// This computes each entry's own gapless position within its company + fiscal year
// at READ TIME, never stored. Storing it would mean an UPDATE against every already-
// posted entry to backfill one, which CLAUDE.md §1 invariant #2 and the
// journal_entries model comment both forbid outright (the erp_app DB role has no
// UPDATE grant on this table at all). Computing it on read has no such cost: posted
// entries are immutable and append-only, so an entry's rank among (created_at, id)
// never changes once assigned.
export async function ledgerNumbersByEntryId(
  prisma: PrismaClient,
  companyId: string,
  entryIds: readonly string[],
): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<{ entry_id: string; ledger_seq: bigint }[]>`
    SELECT je.id AS entry_id,
      (
        SELECT COUNT(*)::bigint
        FROM journal_entries je2
        JOIN fiscal_periods fp2 ON fp2.id = je2.fiscal_period_id
        WHERE je2.company_id = je.company_id
          AND fp2.fiscal_year_id = fp.fiscal_year_id
          AND (je2.created_at, je2.id) <= (je.created_at, je.id)
      ) AS ledger_seq
    FROM journal_entries je
    JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
    WHERE je.company_id = ${companyId} AND je.id = ANY(${entryIds as string[]}::text[])
  `;

  return new Map(rows.map((row) => [row.entry_id, String(row.ledger_seq).padStart(6, "0")]));
}
