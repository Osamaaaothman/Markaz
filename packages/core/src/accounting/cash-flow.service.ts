// IAS 7 Statement of Cash Flows — Indirect Method.
//
// Classification uses the Saudi uniform CoA code prefix (docs/01-OPEN-DECISIONS.md D1 closed):
//   "111x"            → Cash and cash equivalents (petty cash, bank accounts)
//   "11" (non-111x)   → Other current assets (receivables, inventory, prepaid)
//   "12","13","14","15" → Non-current assets (PP&E, ROU, investments)
//   "21"              → Current liabilities
//   "22"              → Non-current liabilities
//   "3x"              → Equity
//
// Every balance uses base-currency amounts (base_debit/base_credit) for functional-currency
// comparability, matching the income statement and balance sheet.
import type { PrismaClient } from "@erp/db";
import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";
import { computeRevenueAndExpense } from "./revenue-expense.util.js";

export interface CashFlowLine {
  readonly label: string;
  readonly labelAr: string;
  readonly amount: string;
}

export interface CashFlowSection {
  readonly lines: readonly CashFlowLine[];
  readonly total: string;
}

export interface CashFlowResult {
  readonly from: string;
  readonly to: string;
  readonly operating: CashFlowSection;
  readonly investing: CashFlowSection;
  readonly financing: CashFlowSection;
  readonly netChange: string;
  readonly beginningCash: string;
  readonly endingCash: string;
  // If |netChange - (endingCash - beginningCash)| > 0.0001, something is off — the
  // controller surfaces this as a non-blocking warning.
  readonly isBalanced: boolean;
}

interface BalanceRow {
  readonly account_id: string;
  readonly code: string;
  readonly name: string;
  readonly name_ar: string | null;
  readonly type: string;
  readonly normal_balance: string;
  readonly debit_total: string;
  readonly credit_total: string;
}

export class CashFlowService {
  constructor(private readonly prisma: PrismaClient) {}

  async compute(companyId: string, from: Date, to: Date): Promise<CashFlowResult> {
    // Net income for the period
    const ie = await computeRevenueAndExpense(this.prisma, companyId, { from, to });
    const netIncome = toScaledBigInt(ie.netIncome);

    // All balance sheet accounts with their cumulative balance at two points:
    //   "beginning" = up to the day before `from`
    //   "ending"    = up to and including `to`
    const dayBefore = new Date(from);
    dayBefore.setDate(dayBefore.getDate() - 1);

    const [beginRows, endRows] = await Promise.all([
      this.fetchBalances(companyId, dayBefore),
      this.fetchBalances(companyId, to),
    ]);

    const beginMap = toBalanceMap(beginRows);
    const endMap = toBalanceMap(endRows);

    // Compute net balance (positive = normal balance side) for each account at each point
    const accountIds = new Set([...beginMap.keys(), ...endMap.keys()]);

    let beginCash = 0n;
    let endCash   = 0n;

    // Working capital adjustments (operating)
    let deltaOtherCurrentAssets    = 0n; // 11x (non-cash) — increase = bad for cash
    let deltaCurrentLiabilities    = 0n; // 21x — increase = good for cash

    // Investing
    let deltaNonCurrentAssets      = 0n; // 12x,13x,14x,15x — increase = cash used

    // Financing
    let deltaNonCurrentLiabilities = 0n; // 22x — increase = cash received
    let deltaEquity                = 0n; // 3x  — increase = cash contributed

    const allRows = await this.fetchAllAccountMeta(companyId);
    const metaMap = new Map(allRows.map((r) => [r.account_id, r]));

    for (const id of accountIds) {
      const meta = metaMap.get(id);
      if (!meta) continue;

      const beginBal = netBalance(beginMap.get(id) ?? { debit: 0n, credit: 0n }, meta.normal_balance);
      const endBal   = netBalance(endMap.get(id)   ?? { debit: 0n, credit: 0n }, meta.normal_balance);
      const change = endBal - beginBal;

      const code = meta.code;

      if (isCashAccount(code)) {
        beginCash += beginBal;
        endCash   += endBal;
      } else if (code.startsWith("11")) {
        // Other current assets — increase in asset = decrease in cash
        deltaOtherCurrentAssets += change;
      } else if (code.startsWith("21")) {
        deltaCurrentLiabilities += change;
      } else if (
        code.startsWith("12") ||
        code.startsWith("13") ||
        code.startsWith("14") ||
        code.startsWith("15")
      ) {
        deltaNonCurrentAssets += change;
      } else if (code.startsWith("22")) {
        deltaNonCurrentLiabilities += change;
      } else if (code.startsWith("3")) {
        deltaEquity += change;
      }
      // Revenue and expense accounts (4x, 5x, 6x) are captured via netIncome above
    }

    // ── Operating ──
    const workingCapitalAdj = -deltaOtherCurrentAssets + deltaCurrentLiabilities;
    const operatingTotal = netIncome + workingCapitalAdj;

    // ── Investing ──
    const investingTotal = -deltaNonCurrentAssets;

    // ── Financing ──
    const financingTotal = deltaNonCurrentLiabilities + deltaEquity;

    const netChange = operatingTotal + investingTotal + financingTotal;
    const expectedNetChange = endCash - beginCash;

    // Tolerance: 1 unit in the 4th decimal place (one ten-thousandth SAR)
    const diff = netChange - expectedNetChange;
    const isBalanced = diff === 0n || (diff > -2n && diff < 2n);

    return {
      from: toDateOnly(from),
      to: toDateOnly(to),
      operating: {
        lines: [
          { label: "Net Income", labelAr: "صافي الدخل", amount: fromScaledBigInt(netIncome) },
          {
            label: "Changes in current assets (excl. cash)",
            labelAr: "التغير في الأصول المتداولة (عدا النقد)",
            amount: fromScaledBigInt(-deltaOtherCurrentAssets),
          },
          {
            label: "Changes in current liabilities",
            labelAr: "التغير في الالتزامات المتداولة",
            amount: fromScaledBigInt(deltaCurrentLiabilities),
          },
        ],
        total: fromScaledBigInt(operatingTotal),
      },
      investing: {
        lines: [
          {
            label: "Net change in non-current assets",
            labelAr: "صافي التغير في الأصول غير المتداولة",
            amount: fromScaledBigInt(-deltaNonCurrentAssets),
          },
        ],
        total: fromScaledBigInt(investingTotal),
      },
      financing: {
        lines: [
          {
            label: "Net change in long-term liabilities",
            labelAr: "صافي التغير في الالتزامات طويلة الأجل",
            amount: fromScaledBigInt(deltaNonCurrentLiabilities),
          },
          {
            label: "Net change in equity",
            labelAr: "صافي التغير في حقوق الملكية",
            amount: fromScaledBigInt(deltaEquity),
          },
        ],
        total: fromScaledBigInt(financingTotal),
      },
      netChange: fromScaledBigInt(netChange),
      beginningCash: fromScaledBigInt(beginCash),
      endingCash: fromScaledBigInt(endCash),
      isBalanced,
    };
  }

  private fetchBalances(companyId: string, asOf: Date): Promise<BalanceRow[]> {
    return this.prisma.$queryRaw<BalanceRow[]>`
      SELECT a.id AS account_id, a.code, a.name, a.name_ar, a.type, a.normal_balance,
             COALESCE(SUM(l.base_debit), 0)::text AS debit_total,
             COALESCE(SUM(l.base_credit), 0)::text AS credit_total
      FROM accounts a
      JOIN journal_entry_lines l ON l.account_id = a.id
      JOIN journal_entries je ON je.id = l.journal_entry_id
      WHERE a.company_id = ${companyId}
        AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND je.entry_date <= ${asOf}
      GROUP BY a.id, a.code, a.name, a.name_ar, a.type, a.normal_balance
    `;
  }

  private fetchAllAccountMeta(companyId: string): Promise<
    Array<{ account_id: string; code: string; normal_balance: string }>
  > {
    return this.prisma.$queryRaw`
      SELECT id AS account_id, code, normal_balance
      FROM accounts
      WHERE company_id = ${companyId}
        AND type IN ('ASSET', 'LIABILITY', 'EQUITY')
    `;
  }
}

// Cash and cash equivalents: petty cash (11101xx) and bank accounts (11102xx).
// Fixed deposits, margin accounts and WIP are NOT treated as free cash.
function isCashAccount(code: string): boolean {
  return code.startsWith("11101") || code.startsWith("11102");
}

function netBalance(
  bal: { debit: bigint; credit: bigint },
  normalBalance: string,
): bigint {
  return normalBalance === "DEBIT" ? bal.debit - bal.credit : bal.credit - bal.debit;
}

function toBalanceMap(rows: BalanceRow[]): Map<string, { debit: bigint; credit: bigint }> {
  return new Map(
    rows.map((r) => [
      r.account_id,
      { debit: toScaledBigInt(r.debit_total), credit: toScaledBigInt(r.credit_total) },
    ]),
  );
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
