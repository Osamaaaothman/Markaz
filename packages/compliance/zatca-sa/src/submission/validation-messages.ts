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

/** Read only validation feedback, never serialize the provider response or credentials. */
export function providerValidationMessages(response: unknown): { errors: string[]; warnings: string[] } {
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const envelope = object(response);
  const body = Object.hasOwn(envelope, "body") ? object(envelope.body) : envelope;
  const validation = object(body.validationResults);
  return { errors: validationMessages(validation.errorMessages), warnings: validationMessages(validation.warningMessages) };
}

/** Expose only an explicit positive authority result, never the raw response. */
export function providerAcceptanceStatus(response: unknown): "CLEARED" | "REPORTED" | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const body = response as Record<string, unknown>;
  if (body.clearanceStatus === "CLEARED") return "CLEARED";
  if (body.reportingStatus === "REPORTED") return "REPORTED";
  return null;
}
