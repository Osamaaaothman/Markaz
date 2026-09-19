import type { PrismaClient } from "@erp/db";
import { rollUpBalances, type AccountBalance, type OwnTotals } from "./account-balances.util.js";

// Posted totals per account, rolled up the chart of accounts so each parent is the sum of
// its children (the chart of accounts screen). Uses the company-currency columns
// (base_debit/base_credit) — the same basis as the balance sheet and income statement — so a
// foreign-currency entry never mixes currencies into one number. Every journal line is
// already posted and immutable (docs/05 §1), and a reversal is just another entry, so summing
// all lines is the posted balance.
export class AccountBalancesService {
  constructor(private readonly prisma: PrismaClient) {}

  // Only accounts with any activity in their subtree are returned; an id that is absent has
  // no postings and reads as zero.
  async compute(companyId: string): Promise<AccountBalance[]> {
    const [accounts, rows] = await Promise.all([
      // Inactive accounts stay in the tree so their history still rolls up into their parents.
      this.prisma.account.findMany({ where: { companyId }, select: { id: true, parentId: true } }),
      this.prisma.$queryRaw<{ account_id: string; debit_total: string; credit_total: string }[]>`
        SELECT
          l.account_id,
          SUM(l.base_debit)::text AS debit_total,
          SUM(l.base_credit)::text AS credit_total
        FROM journal_entry_lines l
        JOIN accounts a ON a.id = l.account_id
        WHERE a.company_id = ${companyId}
        GROUP BY l.account_id
      `,
    ]);

    const own = new Map<string, OwnTotals>(
      rows.map((row) => [row.account_id, { debit: row.debit_total, credit: row.credit_total }]),
    );

    return rollUpBalances(accounts, own).filter(
      (balance) => balance.debitTotal !== "0.0000" || balance.creditTotal !== "0.0000",
    );
  }
}
