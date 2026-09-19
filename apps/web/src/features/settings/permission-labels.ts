// Permission codes are "<resource>:<action>" (e.g. "journal_entry:create") —
// meaningful to the API, but a wall of raw codes is not readable in the UI.
// This groups them by resource so each shows as one line: "Journal entries: Create, View".

const RESOURCE_ORDER = [
  "journal_entry",
  "account",
  "party",
  "trial_balance",
  "balance_sheet",
  "income_statement",
  "fiscal_period",
  "user",
  "role",
] as const;

export function splitPermissionCode(code: string): { resource: string; action: string } {
  const [resource, action] = code.split(":");
  return { resource: resource ?? code, action: action ?? "" };
}

export interface PermissionGroup {
  readonly resource: string;
  readonly actions: readonly string[];
}

// Groups by resource, ordered by RESOURCE_ORDER first, then any unknown
// resource alphabetically after — so a future permission never disappears.
export function groupPermissionsByResource(codes: readonly string[]): PermissionGroup[] {
  const byResource = new Map<string, string[]>();
  for (const code of codes) {
    const { resource, action } = splitPermissionCode(code);
    const actions = byResource.get(resource) ?? [];
    actions.push(action);
    byResource.set(resource, actions);
  }

  const known = RESOURCE_ORDER.filter((r) => byResource.has(r));
  const unknown = [...byResource.keys()].filter((r) => !RESOURCE_ORDER.includes(r as never)).sort();

  return [...known, ...unknown].map((resource) => ({
    resource,
    actions: byResource.get(resource) ?? [],
  }));
}
