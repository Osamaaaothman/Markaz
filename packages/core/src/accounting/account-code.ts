// Next free account code under a parent -- the server's copy of `suggestNextCode` in
// apps/web/src/features/accounting/account-code.ts, so an account the system creates by itself (an employee's accounts)
// is numbered by exactly the rule the Add-account dialog uses. Keep the two in step.
//
// The chart's codes are built by appending to the parent's code; the width of what is appended depends on the parent's level:
//   level-1 root   -> 1 digit   (1   -> 11)
//   level-2 group  -> 3 digits  (11  -> 11108, the first being 101)
//   level 3 and 4  -> 2 digits  (11108 -> 1110801, the first being 01)

export interface CodedAccount {
  readonly id: string;
  readonly code: string;
  readonly parentId: string | null;
}

function levelOf(account: CodedAccount, byId: ReadonlyMap<string, CodedAccount>): number {
  let level = 1;
  let current = account;
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

const suffixWidth = (parentLevel: number): number => (parentLevel <= 1 ? 1 : parentLevel === 2 ? 3 : 2);
const firstSuffix = (parentLevel: number): number => (parentLevel === 2 ? 101 : 1);
const DIGITS_ONLY = /^\d+$/;

// The next free code under `parentId`, or null when the automatic numbering has run out of room. Gaps are never filled
// (`01, 03` suggests `04`); lettered codes do not affect the count.
export function suggestNextChildCode(accounts: readonly CodedAccount[], parentId: string): string | null {
  const taken = new Set(accounts.map((a) => a.code));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parent = byId.get(parentId);
  if (!parent) return null;

  const parentLevel = levelOf(parent, byId);
  const width = suffixWidth(parentLevel);
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
