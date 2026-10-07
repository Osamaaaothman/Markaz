import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";

export interface LedgerStatementLine {
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  // Running balance in the account's natural direction (debit-normal: debit − credit).
  readonly balance: string;
}

export interface LedgerStatement {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly normalBalance: "DEBIT" | "CREDIT";
  readonly from: string;
  readonly to: string;
  readonly openingBalance: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly closingBalance: string;
  readonly lines: readonly LedgerStatementLine[];
  // True when the period holds more lines than the report returns; the totals and the closing
  // balance still cover the whole period, only the listed lines stop short.
  readonly truncated: boolean;
}

export const LEDGER_STATEMENT_LINE_LIMIT = 5000;

export class LedgerAccountNotFoundError extends Error {
  constructor() {
    super("Account not found");
    this.name = "LedgerAccountNotFoundError";
  }
}

export interface RawLedgerLine {
  readonly entryId: string;
  readonly entryNumber: string;
  readonly entryDate: string;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
}

// Pure: folds period lines over an opening balance into running balances. Kept apart from the
// query so the arithmetic (docs/04 §2 — scaled BigInt, never floats) is testable without a DB.
export function foldLedgerLines(
  normalBalance: "DEBIT" | "CREDIT",
  openingDebit: string,
  openingCredit: string,
  lines: readonly RawLedgerLine[],
): { openingBalance: string; closingBalance: string; lines: LedgerStatementLine[] } {
  const sign = normalBalance === "DEBIT" ? 1n : -1n;
  const opening = (toScaledBigInt(openingDebit) - toScaledBigInt(openingCredit)) * sign;
  let running = opening;
  const out: LedgerStatementLine[] = [];
  for (const line of lines) {
    running += (toScaledBigInt(line.debit) - toScaledBigInt(line.credit)) * sign;
    out.push({ ...line, balance: fromScaledBigInt(running) });
  }
  return { openingBalance: fromScaledBigInt(opening), closingBalance: fromScaledBigInt(running), lines: out };
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  normal_balance: string;
}

interface SumRow {
  debit: string;
  credit: string;
}

interface LineRow {
  entry_id: string;
  number: string;
  entry_date: Date;
  description: string | null;
  debit: string;
  credit: string;
}

// A single account's statement: the balance carried in, every posting in the period, and the
// balance carried out. Base-currency amounts, like the balance sheet and income statement.
export class GeneralLedgerService {
  constructor(private readonly prisma: PrismaClient) {}

  async statement(companyId: string, accountId: string, from: Date, to: Date): Promise<LedgerStatement> {
    const accounts = await this.prisma.$queryRaw<AccountRow[]>`
      SELECT id, code, name, normal_balance FROM accounts
      WHERE id = ${accountId} AND company_id = ${companyId}
    `;
    const account = accounts[0];
    if (!account) throw new LedgerAccountNotFoundError();
    const normalBalance = account.normal_balance === "CREDIT" ? "CREDIT" : "DEBIT";

    const [opening, period, rows] = await Promise.all([
      this.prisma.$queryRaw<SumRow[]>`
        SELECT COALESCE(SUM(l.base_debit), 0)::text AS debit, COALESCE(SUM(l.base_credit), 0)::text AS credit
        FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE l.account_id = ${accountId} AND je.company_id = ${companyId} AND je.entry_date < ${from}
      `,
      this.prisma.$queryRaw<SumRow[]>`
        SELECT COALESCE(SUM(l.base_debit), 0)::text AS debit, COALESCE(SUM(l.base_credit), 0)::text AS credit
        FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE l.account_id = ${accountId} AND je.company_id = ${companyId}
          AND je.entry_date >= ${from} AND je.entry_date <= ${to}
      `,
      this.prisma.$queryRaw<LineRow[]>`
        SELECT je.id AS entry_id, je.number, je.entry_date, l.description,
               l.base_debit::text AS debit, l.base_credit::text AS credit
        FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
        WHERE l.account_id = ${accountId} AND je.company_id = ${companyId}
          AND je.entry_date >= ${from} AND je.entry_date <= ${to}
        ORDER BY je.entry_date, je.created_at, l.line_number
        LIMIT ${LEDGER_STATEMENT_LINE_LIMIT + 1}
      `,
    ]);

    const truncated = rows.length > LEDGER_STATEMENT_LINE_LIMIT;
    const shown = rows.slice(0, LEDGER_STATEMENT_LINE_LIMIT);

    const periodDebit = period[0]?.debit ?? "0";
    const periodCredit = period[0]?.credit ?? "0";

    // The listed lines may stop short of the period (truncated), so the closing balance comes
    // from the period totals rather than from the last listed running balance.
    const folded = foldLedgerLines(
      normalBalance,
      opening[0]?.debit ?? "0",
      opening[0]?.credit ?? "0",
      shown.map((r) => ({
        entryId: r.entry_id,
        entryNumber: r.number,
        entryDate: r.entry_date.toISOString().slice(0, 10),
        description: r.description,
        debit: r.debit,
        credit: r.credit,
      })),
    );
    const sign = normalBalance === "DEBIT" ? 1n : -1n;
    const closing =
      toScaledBigInt(folded.openingBalance) + (toScaledBigInt(periodDebit) - toScaledBigInt(periodCredit)) * sign;

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      normalBalance,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      openingBalance: folded.openingBalance,
      totalDebit: fromScaledBigInt(toScaledBigInt(periodDebit)),
      totalCredit: fromScaledBigInt(toScaledBigInt(periodCredit)),
      closingBalance: fromScaledBigInt(closing),
      lines: folded.lines,
      truncated,
    };
  }
}
