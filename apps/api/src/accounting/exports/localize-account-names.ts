// The report services return each line as { accountId, accountName } with the English
// name (their SQL stays language-agnostic). For an Arabic export the name is swapped for
// the account's Arabic name where one exists. Report shapes differ (trial balance has
// `lines`, the balance sheet has assets/liabilities/equity sections, the income
// statement has revenue/expense), so this walks any result and touches only objects that
// carry both fields, instead of one mapper per report.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function collectAccountIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectAccountIds(item, into);
  } else if (isRecord(value)) {
    if (typeof value.accountId === "string" && typeof value.accountName === "string") {
      into.add(value.accountId);
    }
    for (const child of Object.values(value)) collectAccountIds(child, into);
  }
  return into;
}

export function withAccountNames<T>(value: T, nameById: ReadonlyMap<string, string>): T {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) copy[key] = visit(child);
    if (typeof node.accountId === "string" && typeof node.accountName === "string") {
      const localized = nameById.get(node.accountId);
      if (localized) copy.accountName = localized;
    }
    return copy;
  };
  return visit(value) as T;
}
