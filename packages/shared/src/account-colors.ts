// The colours a top-level account can be drawn in. One list for the API (which rejects any
// other value) and the web app (which offers these swatches), so they cannot drift apart.
// #RRGGBB, matching the accounts.color CHECK constraint.
export const ACCOUNT_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
  "#64748B",
  "#A16207",
  "#06B6D4",
] as const;

export type AccountColor = (typeof ACCOUNT_COLORS)[number];

export function isAccountColor(value: string): value is AccountColor {
  return (ACCOUNT_COLORS as readonly string[]).includes(value.toUpperCase());
}
