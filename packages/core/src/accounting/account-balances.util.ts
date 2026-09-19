import { fromScaledBigInt, toScaledBigInt } from "./decimal-sum.util.js";

export interface AccountNode {
  readonly id: string;
  readonly parentId: string | null;
}

// Decimal strings, NUMERIC(19,4) scale, e.g. "125.5000".
export interface OwnTotals {
  readonly debit: string;
  readonly credit: string;
}

export interface AccountBalance {
  readonly accountId: string;
  // The account's own postings plus those of every descendant.
  readonly debitTotal: string;
  readonly creditTotal: string;
  // |debit - credit| and which side is larger; side is null when they cancel out.
  readonly balance: string;
  readonly balanceSide: "DEBIT" | "CREDIT" | null;
}

// Rolls each account's own posted totals up the tree so a parent shows the sum of its
// children, all the way up. Sums are exact: NUMERIC(19,4) values are scaled to BigInt
// (docs/04-DATA-MODEL-RULES.md §2 — never floats). An account whose parent is missing from
// the list, or that sits in a parent cycle, is treated as a root instead of failing.
export function rollUpBalances(
  accounts: readonly AccountNode[],
  ownTotals: ReadonlyMap<string, OwnTotals>,
): AccountBalance[] {
  const known = new Set(accounts.map((a) => a.id));
  const children = new Map<string, string[]>();
  for (const account of accounts) {
    if (account.parentId !== null && account.parentId !== account.id && known.has(account.parentId)) {
      const siblings = children.get(account.parentId) ?? [];
      siblings.push(account.id);
      children.set(account.parentId, siblings);
    }
  }

  const memo = new Map<string, { debit: bigint; credit: bigint }>();
  const total = (id: string, path: ReadonlySet<string>): { debit: bigint; credit: bigint } => {
    const cached = memo.get(id);
    if (cached) return cached;

    const own = ownTotals.get(id);
    let debit = own ? toScaledBigInt(own.debit) : 0n;
    let credit = own ? toScaledBigInt(own.credit) : 0n;
    const nextPath = new Set(path).add(id);
    for (const childId of children.get(id) ?? []) {
      if (nextPath.has(childId)) continue; // cycle guard
      const child = total(childId, nextPath);
      debit += child.debit;
      credit += child.credit;
    }
    const result = { debit, credit };
    memo.set(id, result);
    return result;
  };

  return accounts.map((account) => {
    const { debit, credit } = total(account.id, new Set());
    const net = debit - credit;
    return {
      accountId: account.id,
      debitTotal: fromScaledBigInt(debit),
      creditTotal: fromScaledBigInt(credit),
      balance: fromScaledBigInt(net < 0n ? -net : net),
      balanceSide: net > 0n ? "DEBIT" : net < 0n ? "CREDIT" : null,
    };
  });
}
