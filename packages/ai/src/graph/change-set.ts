import { HumanMessage } from "@langchain/core/messages";
import { resolveRefs } from "../tools/policy.js";
import type { ErpTool, ToolContext, WriteResult } from "../tools/types.js";
import { errorCode } from "./assistant-graph.js";
import type { ProposedItem } from "./events.js";

export type Decision = "approve" | "reject";

export type ItemOutcome =
  | { readonly id: string; readonly status: "executed"; readonly result: WriteResult; readonly args: Readonly<Record<string, unknown>> }
  | { readonly id: string; readonly status: "rejected" }
  | { readonly id: string; readonly status: "skipped"; readonly reason: "DEPENDS_ON_UNEXECUTED" }
  | { readonly id: string; readonly status: "failed"; readonly errorCode: string };

export interface DecisionInput {
  readonly items: readonly ProposedItem[];
  readonly decisions: Readonly<Record<string, Decision>>;
  // The user may correct a field on the card before approving (e.g. the salary).
  readonly edits?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly tools: readonly ErpTool[];
  readonly ctx: ToolContext;
  readonly priorResults?: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly onOutcome?: (outcome: ItemOutcome) => void;
}

// Runs the approved items one by one, in the order they were proposed.
//
// Not one database transaction: each core service owns its own transaction (with numbering and
// audit inside it), and the assistant must not reach around them. So if item 2 fails, item 1 stays
// done. That is acceptable only because every write tool the assistant offers is low risk (drafts
// and master data that can be edited or deactivated). An item whose "$ref" points at something that
// did not run is skipped, never run with a missing value.
export async function executeDecisions(input: DecisionInput): Promise<ItemOutcome[]> {
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const results = new Map(input.priorResults ?? []);
  const outcomes: ItemOutcome[] = [];
  const done = (o: ItemOutcome): void => { outcomes.push(o); input.onOutcome?.(o); };

  for (const item of input.items) {
    if (input.decisions[item.id] !== "approve") { done({ id: item.id, status: "rejected" }); continue; }
    if (item.dependsOn.some((d) => !results.has(d))) { done({ id: item.id, status: "skipped", reason: "DEPENDS_ON_UNEXECUTED" }); continue; }
    const tool = byName.get(item.tool);
    if (!tool || tool.kind !== "write") { done({ id: item.id, status: "failed", errorCode: "UNKNOWN_TOOL" }); continue; }
    try {
      if (!(await input.ctx.can(tool.permission.resource, tool.permission.action))) {
        done({ id: item.id, status: "failed", errorCode: "FORBIDDEN" });
        continue;
      }
      const merged = { ...item.args, ...(input.edits?.[item.id] ?? {}) };
      const parsed = tool.input.safeParse(resolveRefs(merged, results));
      if (!parsed.success) { done({ id: item.id, status: "failed", errorCode: "INVALID_ARGUMENTS" }); continue; }
      const result = await tool.execute(input.ctx, parsed.data);
      results.set(item.id, result.data);
      done({ id: item.id, status: "executed", result, args: merged });
    } catch (error) {
      done({ id: item.id, status: "failed", errorCode: errorCode(error) });
    }
  }
  return outcomes;
}

// After the user decides, the model is told what really happened so it can summarise honestly.
// Sent as a user-role message because every provider accepts that between turns.
export function outcomesMessage(outcomes: readonly ItemOutcome[]): HumanMessage {
  const lines = outcomes.map((o) => {
    switch (o.status) {
      case "executed": return `${o.id}: EXECUTED ${JSON.stringify({ untrusted_data: JSON.stringify(o.result.data) })}`;
      case "rejected": return `${o.id}: REJECTED by the user — do not retry it unless asked.`;
      case "skipped": return `${o.id}: SKIPPED because a change it depends on was not executed.`;
      case "failed": return `${o.id}: FAILED with error ${o.errorCode}.`;
    }
  });
  return new HumanMessage(`[System notice — result of the review, not typed by the user]\n${lines.join("\n")}\nSummarise briefly for the user what was done and what was not, naming only these cards. Cards not listed here were not decided and are not done. Then name the next step of the process, if there is one.`);
}
