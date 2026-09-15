import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";

export interface RevenueExpenseAccountRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: "REVENUE" | "EXPENSE";
  // Always positive: the credit-normal net for a revenue account, the debit-normal
  // net for an expense account.
  readonly amount: string;
}

export interface RevenueExpenseTotals {
  readonly revenueLines: readonly RevenueExpenseAccountRow[];
  readonly expenseLines: readonly RevenueExpenseAccountRow[];
  readonly totalRevenue: string;
  readonly totalExpense: string;
  readonly netIncome: string;
}

interface RawRow {
  readonly account_id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly debit_total: string;
  readonly credit_total: string;
}

// Shared by the income statement (a specific fiscal-period range) and the balance
// sheet's "current year earnings" line (all-time net income folded into equity,
// since there is no year-end closing process yet — a known M2 gap, not this
// feature's scope). Uses base-currency amounts (base_debit/base_credit), unlike
// the trial balance, which still sums transaction-currency amounts directly —
// see the REVIEW note left on trial-balance.service.ts.
export async function computeRevenueAndExpense(
  prisma: PrismaClient,
  companyId: string,
  dateRange?: { readonly from: Date; readonly to: Date },
): Promise<RevenueExpenseTotals> {
  const rows = dateRange
    ? await prisma.$queryRaw<RawRow[]>`
        SELECT a.id AS account_id, a.code, a.name, a.type,
               COALESCE(SUM(l.base_debit), 0)::text AS debit_total,
               COALESCE(SUM(l.base_credit), 0)::text AS credit_total
        FROM accounts a
        JOIN journal_entry_lines l ON l.account_id = a.id
        JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE a.company_id = ${companyId}
          AND a.type IN ('REVENUE', 'EXPENSE')
          AND je.entry_date >= ${dateRange.from}
          AND je.entry_date <= ${dateRange.to}
        GROUP BY a.id, a.code, a.name, a.type
        HAVING COALESCE(SUM(l.base_debit), 0) <> 0 OR COALESCE(SUM(l.base_credit), 0) <> 0
        ORDER BY a.code
      `
    : await prisma.$queryRaw<RawRow[]>`
        SELECT a.id AS account_id, a.code, a.name, a.type,
               COALESCE(SUM(l.base_debit), 0)::text AS debit_total,
               COALESCE(SUM(l.base_credit), 0)::text AS credit_total
        FROM accounts a
        LEFT JOIN journal_entry_lines l ON l.account_id = a.id
        WHERE a.company_id = ${companyId} AND a.type IN ('REVENUE', 'EXPENSE')
        GROUP BY a.id, a.code, a.name, a.type
        HAVING COALESCE(SUM(l.base_debit), 0) <> 0 OR COALESCE(SUM(l.base_credit), 0) <> 0
        ORDER BY a.code
      `;

  const revenueLines: RevenueExpenseAccountRow[] = [];
  const expenseLines: RevenueExpenseAccountRow[] = [];
  let totalRevenue = 0n;
  let totalExpense = 0n;

  for (const row of rows) {
    const debit = toScaledBigInt(row.debit_total);
    const credit = toScaledBigInt(row.credit_total);
    if (row.type === "REVENUE") {
      const net = credit - debit;
      totalRevenue += net;
      revenueLines.push({
        accountId: row.account_id,
        accountCode: row.code,
        accountName: row.name,
        accountType: "REVENUE",
        amount: fromScaledBigInt(net),
      });
    } else {
      const net = debit - credit;
      totalExpense += net;
      expenseLines.push({
        accountId: row.account_id,
        accountCode: row.code,
        accountName: row.name,
        accountType: "EXPENSE",
        amount: fromScaledBigInt(net),
      });
    }
  }

  return {
    revenueLines,
    expenseLines,
    totalRevenue: fromScaledBigInt(totalRevenue),
    totalExpense: fromScaledBigInt(totalExpense),
    netIncome: fromScaledBigInt(totalRevenue - totalExpense),
  };
}
