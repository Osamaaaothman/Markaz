import type { PrismaClient } from "@erp/db";

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

function toScaledBigInt(decimalString: string): bigint {
  const [whole = "0", fraction = ""] = decimalString.split(".");
  const paddedFraction = fraction.padEnd(4, "0").slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(paddedFraction || "0") * (whole.startsWith("-") ? -1n : 1n);
}

function fromScaledBigInt(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 10000n;
  const fraction = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
