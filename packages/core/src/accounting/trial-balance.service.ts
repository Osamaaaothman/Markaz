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

// A trial balance for a period: what each account stood at when the period began (opening), what was posted during it
// (movement, both sides) and where it stood at the end (closing). Opening and closing are the NET balance of the
// account shown on the side it belongs to, so each account has a figure on one side only there.
export interface PeriodTrialBalanceLine {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly movementDebit: string;
  readonly movementCredit: string;
  readonly closingDebit: string;
  readonly closingCredit: string;
}

export interface PeriodTrialBalanceTotals {
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly movementDebit: string;
  readonly movementCredit: string;
  readonly closingDebit: string;
  readonly closingCredit: string;
}

export interface PeriodTrialBalanceResult {
  readonly from: string;
  readonly to: string;
  readonly lines: readonly PeriodTrialBalanceLine[];
  readonly totals: PeriodTrialBalanceTotals;
  // Every pair of columns (opening, movement, closing) has equal debit and credit totals.
  readonly isBalanced: boolean;
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
// The net balance (debit minus credit, scaled by 10^4) as a debit figure and a credit figure; one of them is zero.
export function splitNetBalance(net: bigint): { readonly debit: bigint; readonly credit: bigint } {
  return net >= 0n ? { debit: net, credit: 0n } : { debit: 0n, credit: -net };
}

interface PeriodRow {
  account_id: string;
  code: string;
  name: string;
  type: string;
  opening_net: string;
  movement_debit: string;
  movement_credit: string;
}

// Turns the per-account sums into the report: pure, so it is tested without a database.
export function buildPeriodTrialBalance(
  rows: readonly { accountId: string; accountCode: string; accountName: string; accountType: string; openingNet: string; movementDebit: string; movementCredit: string }[],
  from: string,
  to: string,
): PeriodTrialBalanceResult {
  const total = { od: 0n, oc: 0n, md: 0n, mc: 0n, cd: 0n, cc: 0n };
  const lines: PeriodTrialBalanceLine[] = [];
  for (const row of rows) {
    const openingNet = toScaledBigInt(row.openingNet);
    const movementDebit = toScaledBigInt(row.movementDebit);
    const movementCredit = toScaledBigInt(row.movementCredit);
    if (openingNet === 0n && movementDebit === 0n && movementCredit === 0n) continue;
    const opening = splitNetBalance(openingNet);
    const closing = splitNetBalance(openingNet + movementDebit - movementCredit);
    total.od += opening.debit;
    total.oc += opening.credit;
    total.md += movementDebit;
    total.mc += movementCredit;
    total.cd += closing.debit;
    total.cc += closing.credit;
    lines.push({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      openingDebit: fromScaledBigInt(opening.debit),
      openingCredit: fromScaledBigInt(opening.credit),
      movementDebit: fromScaledBigInt(movementDebit),
      movementCredit: fromScaledBigInt(movementCredit),
      closingDebit: fromScaledBigInt(closing.debit),
      closingCredit: fromScaledBigInt(closing.credit),
    });
  }
  return {
    from,
    to,
    lines,
    totals: {
      openingDebit: fromScaledBigInt(total.od),
      openingCredit: fromScaledBigInt(total.oc),
      movementDebit: fromScaledBigInt(total.md),
      movementCredit: fromScaledBigInt(total.mc),
      closingDebit: fromScaledBigInt(total.cd),
      closingCredit: fromScaledBigInt(total.cc),
    },
    isBalanced: total.od === total.oc && total.md === total.mc && total.cd === total.cc,
  };
}

export class TrialBalanceService {
  constructor(private readonly prisma: PrismaClient) {}

  // The period trial balance, in the company's base currency (base_debit / base_credit, the same figures the general
  // ledger uses). Entries are placed by their entry date: before `from` they make the opening balance, from `from` to
  // `to` (both included) they are the movement, after `to` they are left out.
  async computeForPeriod(companyId: string, from: Date, to: Date): Promise<PeriodTrialBalanceResult> {
    const rows = await this.prisma.$queryRaw<PeriodRow[]>`
      SELECT
        a.id AS account_id,
        a.code,
        a.name,
        a.type,
        COALESCE(SUM(CASE WHEN je.entry_date < ${from} THEN l.base_debit - l.base_credit END), 0)::text AS opening_net,
        COALESCE(SUM(CASE WHEN je.entry_date >= ${from} THEN l.base_debit END), 0)::text AS movement_debit,
        COALESCE(SUM(CASE WHEN je.entry_date >= ${from} THEN l.base_credit END), 0)::text AS movement_credit
      FROM accounts a
      JOIN journal_entry_lines l ON l.account_id = a.id
      JOIN journal_entries je ON je.id = l.journal_entry_id AND je.company_id = a.company_id
      WHERE a.company_id = ${companyId} AND je.entry_date <= ${to}
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code
    `;
    return buildPeriodTrialBalance(
      rows.map((r) => ({
        accountId: r.account_id,
        accountCode: r.code,
        accountName: r.name,
        accountType: r.type,
        openingNet: r.opening_net,
        movementDebit: r.movement_debit,
        movementCredit: r.movement_credit,
      })),
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    );
  }

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
