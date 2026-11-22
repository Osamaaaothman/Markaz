// Tool results come from the company's own data: a customer could be named
// "Ignore your instructions and ...". Everything a tool returns is handed to the model inside this
// envelope, and the system prompt says the envelope is data, never instructions.
//
// The envelope is a speed bump, not the defence. The real defence is structural: no delete tools,
// permission checks in code, and a human approval before anything high-risk is written.

const MAX_CHARS = 12_000;

export function wrapUntrusted(data: unknown): string {
  let json = JSON.stringify(data ?? null);
  let truncated = false;
  if (json.length > MAX_CHARS) {
    json = json.slice(0, MAX_CHARS);
    truncated = true;
  }
  return JSON.stringify({ untrusted_data: json, truncated });
}

export function toolError(code: string, detail?: string): string {
  return JSON.stringify({ error: code, ...(detail ? { detail } : {}) });
}
