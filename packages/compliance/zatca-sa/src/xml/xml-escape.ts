// Minimal XML text/attribute escaping — the five predefined entities, nothing more. Kept local
// to this package rather than reusing apps/api's HTML escaper (docs/02-ARCHITECTURE-RULES.md §1:
// apps/web is the only thing forbidden from reaching into backend internals, but there is no
// reason for this leaf package to depend on apps/api either).
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}
