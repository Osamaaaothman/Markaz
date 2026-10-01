// Account-code suggestion and inference for the Add-account dialog — pure, free of runtime
// imports so it can be unit-tested with plain `node --test` (same approach as account-tree.ts).
//
// The chart's codes are built by appending to the parent's code, and the width of what is
// appended depends on the parent's level (measured on the seeded template):
//   level-1 root   -> 1 digit   (1   -> 11)
//   level-2 group  -> 3 digits  (11  -> 11108, the first being 101)
//   level 3 and 4  -> 2 digits  (11108 -> 1110801, the first being 01)

import type { AccountLike } from "./account-tree";

const ROOT_DIGIT_FOR_TYPE: Readonly<Record<string, string>> = {
  ASSET: "1",
  LIABILITY: "2",
  EQUITY: "3",
  REVENUE: "4",
  EXPENSE: "5",
};

const TYPE_FOR_ROOT_DIGIT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ROOT_DIGIT_FOR_TYPE).map(([type, digit]) => [digit, type]),
);

function levelOf(account: AccountLike, byId: ReadonlyMap<string, AccountLike>): number {
  let level = 1;
  let current = account;
  // The seen-set only guards against a corrupt cycle; a real chart never has one.
  const seen = new Set<string>([current.id]);
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    level += 1;
  }
  return level;
}

function suffixWidth(parentLevel: number): number {
  if (parentLevel <= 1) return 1;
  if (parentLevel === 2) return 3;
  return 2;
}

// The first child under a level-2 group starts at 101; everywhere else at 1 (zero-padded).
function firstSuffix(parentLevel: number): number {
  return parentLevel === 2 ? 101 : 1;
}

const DIGITS_ONLY = /^\d+$/;

// The next free code under `parentId` (null = a new top-level account), or null when the
// automatic numbering has run out of room and the user has to type one. Gaps are never filled
// (`01, 03` suggests `04`); lettered codes such as `2110601A0001` do not affect the count.
export function suggestNextCode(
  accounts: readonly AccountLike[],
  parentId: string | null,
  type: string,
): string | null {
  const taken = new Set(accounts.map((a) => a.code));

  if (parentId === null) {
    const roots = accounts.filter((a) => a.parentId === null && /^\d$/.test(a.code));
    const preferred = ROOT_DIGIT_FOR_TYPE[type];
    if (preferred !== undefined && !taken.has(preferred)) return preferred;
    const highest = roots.reduce((max, a) => Math.max(max, Number(a.code)), 0);
    for (let digit = highest + 1; digit <= 9; digit += 1) {
      if (!taken.has(String(digit))) return String(digit);
    }
    return null;
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parent = byId.get(parentId);
  if (!parent) return null;

  const width = suffixWidth(levelOf(parent, byId));
  const parentLevel = levelOf(parent, byId);
  let highest = 0;
  for (const child of accounts) {
    if (child.parentId !== parent.id || !child.code.startsWith(parent.code)) continue;
    const suffix = child.code.slice(parent.code.length);
    if (suffix.length === width && DIGITS_ONLY.test(suffix)) highest = Math.max(highest, Number(suffix));
  }

  const limit = 10 ** width;
  for (let next = highest === 0 ? firstSuffix(parentLevel) : highest + 1; next < limit; next += 1) {
    const code = `${parent.code}${String(next).padStart(width, "0")}`;
    if (!taken.has(code)) return code;
  }
  return null;
}

export type CodeInference =
  | { readonly kind: "empty" }
  // The code is already used by this account.
  | { readonly kind: "duplicate"; readonly account: AccountLike }
  // The longest existing group whose code starts the typed code.
  | { readonly kind: "parent"; readonly parent: AccountLike }
  // The account that would be the parent takes postings, so it cannot have children.
  | { readonly kind: "postableParent"; readonly parent: AccountLike }
  // A single character with no parent: a new top-level account (type known for digits 1-5).
  | { readonly kind: "root"; readonly type: string | null }
  // More than one character but no existing account starts it.
  | { readonly kind: "noParent" };

// What a typed code implies about the parent and type: the parent is the longest existing
// account whose code is a proper prefix of it.
export function inferFromCode(accounts: readonly AccountLike[], rawCode: string): CodeInference {
  const code = rawCode.trim();
  if (code === "") return { kind: "empty" };

  const same = accounts.find((a) => a.code === code);
  if (same) return { kind: "duplicate", account: same };

  let parent: AccountLike | null = null;
  for (const account of accounts) {
    if (account.code.length < code.length && code.startsWith(account.code)) {
      if (parent === null || account.code.length > parent.code.length) parent = account;
    }
  }

  if (parent === null) {
    return code.length === 1 ? { kind: "root", type: TYPE_FOR_ROOT_DIGIT[code] ?? null } : { kind: "noParent" };
  }
  return parent.isPostable ? { kind: "postableParent", parent } : { kind: "parent", parent };
}
