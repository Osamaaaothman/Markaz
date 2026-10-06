// A controller may answer with a body of its own — { message, code, lineNumber } — to say WHICH
// business rule failed. The error filter lets that code through in place of the generic one derived
// from the HTTP exception class, so a screen can tell "quantity over received" from "duplicate
// invoice" even though both are 409. Kept free of framework imports so it is unit-testable.
export function domainErrorFields(body: unknown): { readonly code?: string; readonly lineNumber?: number } {
  if (typeof body !== "object" || body === null) return {};
  const { code, lineNumber } = body as { code?: unknown; lineNumber?: unknown };
  return {
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof lineNumber === "number" ? { lineNumber } : {}),
  };
}
