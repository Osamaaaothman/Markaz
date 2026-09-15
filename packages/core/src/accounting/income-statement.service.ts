import type { PrismaClient } from "@erp/db";
import { computeRevenueAndExpense, type RevenueExpenseAccountRow } from "./revenue-expense.util.js";

export interface IncomeStatementLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly amount: string;
}

export interface IncomeStatementSection {
  readonly lines: readonly IncomeStatementLine[];
  readonly total: string;
}

export interface IncomeStatementResult {
  readonly from: string;
  readonly to: string;
  readonly revenue: IncomeStatementSection;
  readonly expense: IncomeStatementSection;
  readonly netIncome: string;
}

// docs/14-MILESTONES.md M2: "Trial balance, balance sheet, income statement, cash
// flow" — the first three exist, cash flow is deliberately not built here (method —
// direct vs. indirect — is an accounting-treatment call for Osama, not a code
// decision; docs/01-OPEN-DECISIONS.md).
export class IncomeStatementService {
  constructor(private readonly prisma: PrismaClient) {}

  async compute(companyId: string, from: Date, to: Date): Promise<IncomeStatementResult> {
    const totals = await computeRevenueAndExpense(this.prisma, companyId, { from, to });
    return {
      from: toDateOnly(from),
      to: toDateOnly(to),
      revenue: { lines: toLines(totals.revenueLines), total: totals.totalRevenue },
      expense: { lines: toLines(totals.expenseLines), total: totals.totalExpense },
      netIncome: totals.netIncome,
    };
  }
}

function toLines(rows: readonly RevenueExpenseAccountRow[]): IncomeStatementLine[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    amount: row.amount,
  }));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
