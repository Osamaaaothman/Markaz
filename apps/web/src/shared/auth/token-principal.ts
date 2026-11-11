/** Identity comparison only; authorization always belongs to the verified API token. */
export function tokenPrincipal(token: string | null): string | null {
  if (!token) return null;
  try {
    const value: unknown = JSON.parse(
      atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return value && typeof value === "object" && "sub" in value && typeof value.sub === "string"
      ? value.sub
      : null;
  } catch {
    return null;
  }
}
