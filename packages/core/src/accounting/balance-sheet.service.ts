import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";
import { computeRevenueAndExpense } from "./revenue-expense.util.js";

export interface BalanceSheetLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly balance: string;
}

export interface BalanceSheetSection {
  readonly lines: readonly BalanceSheetLine[];
  readonly total: string;
}

export interface BalanceSheetResult {
  readonly asOf: string;
  readonly assets: BalanceSheetSection;
  readonly liabilities: BalanceSheetSection;
  // Real equity accounts only (e.g. Owner's Equity, Retained Earnings) — the synthetic
  // "current year earnings" line below is kept separate, not mixed into this list,
  // since it isn't a real account.
  readonly equity: BalanceSheetSection;
  readonly currentYearEarnings: string;
  readonly totalEquity: string;
  readonly totalLiabilitiesAndEquity: string;
  readonly isBalanced: boolean;
}

interface RawRow {
  readonly account_id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly normal_balance: string;
  readonly debit_total: string;
  readonly credit_total: string;
}

// docs/14-MILESTONES.md M2. A cumulative-to-date snapshot, like the trial balance.
//
// There is no year-end closing process yet (revenue/expense accounts are never
// zeroed into retained earnings), so a literal sum of ASSET vs. LIABILITY+EQUITY
// account balances would not satisfy the accounting equation whenever there has been
// any unclosed revenue/expense activity. Standard practice for an "unclosed books"
// balance sheet is to fold net income to date into equity as its own line —
// `currentYearEarnings` here — rather than pretend the books are closed. This is
// ordinary double-entry mechanics, not an accounting-treatment judgment call.
export class BalanceSheetService {
  constructor(private readonly prisma: PrismaClient) {}

  async compute(companyId: string): Promise<BalanceSheetResult> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT a.id AS account_id, a.code, a.name, a.type, a.normal_balance,
             COALESCE(SUM(l.base_debit), 0)::text AS debit_total,
             COALESCE(SUM(l.base_credit), 0)::text AS credit_total
      FROM accounts a
      LEFT JOIN journal_entry_lines l ON l.account_id = a.id
      WHERE a.company_id = ${companyId} AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
      GROUP BY a.id, a.code, a.name, a.type, a.normal_balance
      HAVING COALESCE(SUM(l.base_debit), 0) <> 0 OR COALESCE(SUM(l.base_credit), 0) <> 0
      ORDER BY a.code
    `;

    const assets: BalanceSheetLine[] = [];
    const liabilities: BalanceSheetLine[] = [];
    const equity: BalanceSheetLine[] = [];
    let totalAssets = 0n;
    let totalLiabilities = 0n;
    let totalEquityAccounts = 0n;

    for (const row of rows) {
      const debit = toScaledBigInt(row.debit_total);
      const credit = toScaledBigInt(row.credit_total);
      const net = row.normal_balance === "DEBIT" ? debit - credit : credit - debit;
      const line: BalanceSheetLine = {
        accountId: row.account_id,
        accountCode: row.code,
        accountName: row.name,
        balance: fromScaledBigInt(net),
      };
      if (row.type === "ASSET") {
        assets.push(line);
        totalAssets += net;
      } else if (row.type === "LIABILITY") {
        liabilities.push(line);
        totalLiabilities += net;
      } else {
        equity.push(line);
        totalEquityAccounts += net;
      }
    }

    const { netIncome } = await computeRevenueAndExpense(this.prisma, companyId);
    const currentEarnings = toScaledBigInt(netIncome);
    const totalEquity = totalEquityAccounts + currentEarnings;

    return {
      asOf: new Date().toISOString().slice(0, 10),
      assets: { lines: assets, total: fromScaledBigInt(totalAssets) },
      liabilities: { lines: liabilities, total: fromScaledBigInt(totalLiabilities) },
      equity: { lines: equity, total: fromScaledBigInt(totalEquityAccounts) },
      currentYearEarnings: fromScaledBigInt(currentEarnings),
      totalEquity: fromScaledBigInt(totalEquity),
      totalLiabilitiesAndEquity: fromScaledBigInt(totalLiabilities + totalEquity),
      isBalanced: totalAssets === totalLiabilities + totalEquity,
    };
  }
}
