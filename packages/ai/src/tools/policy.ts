import type { AssistantMode, ErpTool, ToolContext, WriteTool } from "./types.js";

// Which tools the model may see. This is the real enforcement of "ask mode cannot change
// anything": the write tools are not offered at all, so no prompt trick can call them.
export function toolsForMode(tools: readonly ErpTool[], mode: AssistantMode): ErpTool[] {
  return mode === "ask" ? tools.filter((t) => t.kind === "read") : [...tools];
}

// Tools the current user is allowed to use at all. A tool the user has no permission for is hidden,
// so the model does not offer something that would fail anyway.
export async function permittedTools(tools: readonly ErpTool[], ctx: ToolContext): Promise<ErpTool[]> {
  const checks = await Promise.all(tools.map((t) => ctx.can(t.permission.resource, t.permission.action)));
  return tools.filter((_, i) => checks[i] === true);
}

// Whether a write runs at once or waits for the user. High risk always waits, whatever the mode.
export function needsApproval(tool: WriteTool, mode: AssistantMode, autoAllowed: boolean): boolean {
  if (tool.risk === "high") return true;
  return !(mode === "auto" && autoAllowed);
}

// A later proposal can point at the result of an earlier one in the same change set:
// "$ref:c1.id" is replaced by the `id` that item c1 returned once it ran.
const REF = /^\$ref:(c\d+)\.([A-Za-z0-9_]+)$/;

export class UnresolvedRefError extends Error {
  constructor(readonly ref: string) {
    super(`Reference ${ref} points at a change that was not executed`);
    this.name = "UnresolvedRefError";
  }
}

export function refsIn(value: unknown): string[] {
  if (typeof value === "string") {
    const m = REF.exec(value);
    return m?.[1] ? [m[1]] : [];
  }
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(refsIn);
  return [];
}

export function resolveRefs(value: unknown, results: ReadonlyMap<string, Readonly<Record<string, unknown>>>): unknown {
  if (typeof value === "string") {
    const m = REF.exec(value);
    if (!m?.[1] || !m[2]) return value;
    const resolved = results.get(m[1])?.[m[2]];
    if (resolved === undefined) throw new UnresolvedRefError(value);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  }
  return value;
}
