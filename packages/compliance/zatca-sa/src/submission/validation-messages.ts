/** The live API returns message objects; older sandbox fixtures return strings. */
export function validationMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const message = typeof item.message === "string" ? item.message : typeof item.errorMessage === "string" ? item.errorMessage : null;
    if (!message) return [];
    return [typeof item.code === "string" ? `${item.code}: ${message}` : message];
  });
}
