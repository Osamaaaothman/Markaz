// Pure permission checks — no runtime imports, so they are unit-testable with plain
// `node --test`. Codes look like "journal_entry:create" (resource:action), the same codes the
// API enforces with @RequirePermission (docs/09-SECURITY-RULES.md). The UI only mirrors those
// rules to hide/disable what would be refused; the API remains the actual enforcement.

export function hasPermission(granted: ReadonlySet<string>, code: string): boolean {
  return granted.has(code);
}

// True when at least one code is granted. An empty requirement means "no permission needed".
export function hasAnyPermission(granted: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.length === 0 || codes.some((code) => granted.has(code));
}

export function hasAllPermissions(granted: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.every((code) => granted.has(code));
}
