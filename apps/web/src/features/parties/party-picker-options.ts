interface PickerParty {
  readonly id: string;
  readonly kind: string;
}

// The linked party can be outside the search page, but must obey the same filter.
export function partyPickerOptions<T extends PickerParty>(
  results: readonly T[] = [],
  current?: T | null,
  excludeEmployees = false,
): T[] {
  const byId = new Map<string, T>();
  if (current) byId.set(current.id, current);
  for (const party of results) byId.set(party.id, party);
  return [...byId.values()].filter((party) => !excludeEmployees || party.kind !== "EMPLOYEE");
}
