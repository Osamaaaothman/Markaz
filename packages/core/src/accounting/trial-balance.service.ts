import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";

export interface TrialBalanceLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly debitTotal: string;
  readonly creditTotal: string;
}

export interface TrialBalanceResult {
  readonly lines: readonly TrialBalanceLine[];
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly isBalanced: boolean;
}

// docs/05-ACCOUNTING-INTEGRITY-RULES.md §7: "Trial balance — must always be zero.
// Expose it in development as a health check." This is the cheapest, highest-value
// reconciliation report in the system — build it early, use it constantly.
//
// REVIEW: this sums transaction-currency debit/credit (l.debit / l.credit), not
// base-currency amounts (l.base_debit / l.base_credit, added later for the balance
// sheet/income statement — see revenue-expense.util.ts). Fine today because every
// posted entry is SAR-only in practice, but if a company ever posts a journal entry
// in a foreign currency, this report silently sums mismatched currencies into one
// number. Left as-is rather than changed opportunistically in an unrelated feature
// branch — flagging for a deliberate fix.
export class TrialBalanceService {
  constructor(private readonly prisma: PrismaClient) {}

  async compute(companyId: string): Promise<TrialBalanceResult> {
    const rows = await this.prisma.$queryRaw<
      {
        account_id: string;
        code: string;
        name: string;
        type: string;
        debit_total: string;
        credit_total: string;
      }[]
    >`
      SELECT
        a.id AS account_id,
        a.code,
        a.name,
        a.type,
        COALESCE(SUM(l.debit), 0)::text AS debit_total,
        COALESCE(SUM(l.credit), 0)::text AS credit_total
      FROM accounts a
      LEFT JOIN journal_entry_lines l ON l.account_id = a.id
      WHERE a.company_id = ${companyId}
      GROUP BY a.id, a.code, a.name, a.type
      HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
      ORDER BY a.code
    `;

    const lines: TrialBalanceLine[] = rows.map((row) => ({
      accountId: row.account_id,
      accountCode: row.code,
      accountName: row.name,
      accountType: row.type,
      debitTotal: row.debit_total,
      creditTotal: row.credit_total,
    }));

    let totalDebit = 0n;
    let totalCredit = 0n;
    // Sum as strings via a simple decimal-safe accumulation (avoids floating point
    // per docs/04 §2) — amounts are NUMERIC(19,4), so scaling by 10^4 and summing as
    // BigInt is exact.
    for (const line of lines) {
      totalDebit += toScaledBigInt(line.debitTotal);
      totalCredit += toScaledBigInt(line.creditTotal);
    }

    return {
      lines,
      totalDebit: fromScaledBigInt(totalDebit),
      totalCredit: fromScaledBigInt(totalCredit),
      isBalanced: totalDebit === totalCredit,
    };
  }
}
