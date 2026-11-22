import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type AIMessageChunk, type BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { isFilesUnsupported, isModelMissing, isProviderBusy } from "../providers/model-factory.js";
import { LOAD_TOOLS, SECTION_CONTENTS, SECTIONS, sectionOf } from "../tools/sections.js";
import { needsApproval, refsIn, resolveRefs, UnresolvedRefError } from "../tools/policy.js";
import type { AssistantMode, ErpTool, ToolContext, WriteResult } from "../tools/types.js";
import { toolError, wrapUntrusted } from "../safety/untrusted.js";
import type { AssistantEvent, ExecutedItem, ProposedItem, TokenUsage } from "./events.js";

// ─── How this file works (the "agent loop" as a LangGraph graph) ─────────────────────────────────
//
//   START ─▶ agent ──(no tool calls)──────────────▶ END
//              ▲  └─(tool calls)─▶ tools ──┐
//              └──────────────────────────┘   (clarify ─▶ END)
//
// agent: one LLM call (streamed token by token to the browser).
// tools: runs each tool call the model asked for —
//        read  → runs now, result goes back to the model;
//        write → validated, previewed, then either runs now (auto mode, low risk) or becomes a
//                PROPOSED item that waits for the user. The model is told it is only proposed.
// The loop ends when the model answers with plain text, asks a clarifying question, or hits the
// step limit. Approval happens outside the graph (change-set.ts), and a fresh run summarises.

export const CLARIFY_TOOL = "clarify";
// Only offered in question mode. One cheap call that ends the turn, so a write request gets an
// immediate "switch mode" card instead of a slow refusal written by the model.
export const MODE_TOOL = "switch_to_interactive";

// Offered only while cards from earlier turns still wait. The model withdraws a waiting card it is
// replacing (a corrected version), so the user is never left with two versions of the same change.
export const WITHDRAW_TOOL = "withdraw_proposal";
const clarifySchema = z.object({
  question: z.string().min(1).describe("One short question in the user's language"),
  options: z.array(z.string().min(1)).min(2).max(5).describe("2-5 short choices"),
});

export interface RunOptions {
  readonly model: BaseChatModel;
  readonly tools: readonly ErpTool[]; // already filtered by mode and permission
  readonly mode: AssistantMode;
  readonly autoAllowed: boolean;
  readonly ctx: ToolContext;
  readonly system: string;
  readonly messages: readonly BaseMessage[]; // full history including the new user message
  // Continue numbering c1, c2, ... across a conversation so references stay unique.
  readonly firstItemNumber: number;
  // Results of earlier executed items in this conversation, for "$ref:" resolution.
  readonly priorResults?: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly emit: (event: AssistantEvent) => void;
  readonly maxSteps?: number;
  readonly signal?: AbortSignal;
  // Tried in order when the model above is busy (503/429/timeout) before it has written anything.
  readonly fallbackModels?: readonly BaseChatModel[];
  // A model that sends nothing for this long is treated as busy (default 25s), so a stalled
  // provider never leaves the user watching "thinking" for a minute.
  readonly stallMs?: number;
  // Sections whose tools are sent from the start (besides the core tools). When set, every other
  // section is loaded on demand with load_tools; when undefined, all tools are sent (as before).
  readonly initialSections?: readonly string[];
  // Cards proposed in earlier turns that still wait for the user's decision (still valid).
  readonly pendingIds?: readonly string[];
}

export interface RunResult {
  readonly newMessages: BaseMessage[];
  readonly proposals: ProposedItem[];
  readonly executed: ExecutedItem[];
  readonly usage: TokenUsage;
  readonly stoppedForClarify: boolean;
  readonly hitStepLimit: boolean;
  // Earlier waiting cards the model withdrew this turn (replaced by a corrected one).
  readonly withdrawn: string[];
}

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  proposals: Annotation<ProposedItem[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  executed: Annotation<ExecutedItem[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  steps: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  inputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  outputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  clarified: Annotation<boolean>({ reducer: (a, b) => a || b, default: () => false }),
  withdrawn: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type S = typeof State.State;

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: unknown) => {
        if (p === null || typeof p !== "object" || (p as { type?: unknown }).type !== "text") return "";
        const text = (p as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}

function lastAi(messages: readonly BaseMessage[]): AIMessage | undefined {
  const last = messages[messages.length - 1];
  return last instanceof AIMessage ? last : undefined;
}

export async function runAssistant(opts: RunOptions): Promise<RunResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const stallMs = opts.stallMs ?? 25_000;
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  // Sections loaded so far this turn (only used when the caller asked for on-demand loading).
  const onDemand = opts.initialSections !== undefined;
  const active = new Set<string>(["core", ...(opts.initialSections ?? [])]);
  const available = SECTIONS.filter((s) => opts.tools.some((t) => sectionOf(t.name) === s));
  const loadSchema = z.object({ section: z.enum(SECTIONS) });
  const waiting = new Set(opts.pendingIds ?? []);
  const withdrawSchema = z.object({ id: z.string().min(1).describe("The waiting card's id, e.g. c4") });
  const llmToolsFor = (): Array<{ name: string; description: string; schema: z.ZodType }> => {
    const notLoaded = available.filter((s) => !active.has(s));
    return [
      ...opts.tools.filter((t) => !onDemand || active.has(sectionOf(t.name))).map((t) => ({ name: t.name, description: t.description, schema: t.input })),
      { name: CLARIFY_TOOL, description: "Ask the user to choose between options when the request is ambiguous. Ends your turn.", schema: clarifySchema },
      ...(waiting.size > 0 && opts.mode !== "ask"
        ? [{ name: WITHDRAW_TOOL, description: `Withdraw a card that is still waiting for approval (${[...waiting].join(", ")}) when the user wants it changed or dropped. Propose the corrected card in the same turn. Never withdraw a card the user still wants.`, schema: withdrawSchema }]
        : []),
      ...(opts.mode === "ask" ? [{ name: MODE_TOOL, description: "Call this at once, alone, when the user asks to create, change or delete anything. Ends your turn.", schema: z.object({}) }] : []),
      ...(onDemand && notLoaded.length
        ? [{
            name: LOAD_TOOLS,
            description:
              "Load the tools of a section before working in it; call it first whenever the request needs a tool you do not have, and never say you cannot do something before loading its section. Sections: " +
              notLoaded.map((s) => `${s} (${SECTION_CONTENTS[s]})`).join("; ") + ".",
            schema: loadSchema,
          }]
        : []),
    ];
  };
  const chain = [opts.model, ...(opts.fallbackModels ?? [])];
  for (const m of chain) if (typeof m.bindTools !== "function") throw new Error("MODEL_HAS_NO_TOOL_SUPPORT");
  // Re-bound only when the loaded sections change; bindTools exists on every model (checked above).
  let boundKey = "";
  let boundChain: ReturnType<NonNullable<BaseChatModel["bindTools"]>>[] = [];
  const bound = (): typeof boundChain => {
    const key = [...active].sort().join(",");
    if (key !== boundKey) {
      const tools = llmToolsFor();
      boundChain = chain.map((m) => m.bindTools!(tools));
      boundKey = key;
    }
    return boundChain;
  };
  let current = 0; // once a fallback answered, stay on it for the rest of the turn
  const knownResults = new Map(opts.priorResults ?? []);
  // Waiting cards from earlier turns can be referenced like this turn's proposals.
  const proposedIds = new Set<string>(opts.pendingIds ?? []);
  let nextItem = opts.firstItemNumber;
  const startLength = opts.messages.length;

  const agent = async (state: S): Promise<Partial<S>> => {
    let full: AIMessageChunk | undefined;
    for (;;) {
      let wrote = false;
      const attempt = new AbortController();
      const cancel = (): void => attempt.abort();
      opts.signal?.addEventListener("abort", cancel, { once: true });
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; attempt.abort(); }, stallMs);
      };
      try {
        arm();
        const stream = await bound()[current]!.stream([new SystemMessage(opts.system), ...state.messages], { signal: attempt.signal });
        for await (const chunk of stream) {
          arm();
          const text = textOf(chunk.content);
          if (text) { wrote = true; opts.emit({ type: "token", text }); }
          full = full ? concat(full, chunk) : chunk;
        }
        break;
      } catch (caught) {
        const error = stalled && !opts.signal?.aborted ? Object.assign(new Error("The model is unavailable: it stopped responding (timed out)"), { status: 504 }) : caught;
        // Switch only if nothing reached the user yet, so an answer is never stitched from two models.
        // A backup that cannot read the attached file is skipped like a busy one; the next may read it.
        if (wrote || opts.signal?.aborted || current >= chain.length - 1 || !(isProviderBusy(error) || isFilesUnsupported(error) || isModelMissing(error))) {
          // Tell the user plainly when the model now answering (a backup) cannot read their file.
          if (isFilesUnsupported(error)) throw Object.assign(new Error(current > 0 ? "BACKUP_MODEL_NO_FILES" : "MODEL_NO_FILES"), { code: current > 0 ? "BACKUP_MODEL_NO_FILES" : "MODEL_NO_FILES" });
          throw error;
        }
        current += 1;
        full = undefined;
        opts.emit({ type: "provider_busy", next: current });
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", cancel);
      }
    }
    const res = full;
    const message = new AIMessage({
      content: res?.content ?? "",
      tool_calls: res?.tool_calls ?? [],
      additional_kwargs: res?.additional_kwargs ?? {},
      response_metadata: res?.response_metadata ?? {},
      ...(res?.id ? { id: res.id } : {}),
    });
    return {
      messages: [message],
      steps: 1,
      inputTokens: usageOf(res).input,
      outputTokens: usageOf(res).output,
    };
  };

  const tools = async (state: S): Promise<Partial<S>> => {
    const ai = lastAi(state.messages);
    const out: ToolMessage[] = [];
    const proposals: ProposedItem[] = [];
    const executed: ExecutedItem[] = [];
    const withdrawn: string[] = [];
    let clarified = false;
    for (const call of ai?.tool_calls ?? []) {
      const callId = call.id ?? `call_${out.length}`;
      const reply = (content: string): void => { out.push(new ToolMessage({ content, tool_call_id: callId, name: call.name })); };
      const started = Date.now();
      opts.emit({ type: "tool_start", callId, tool: call.name });
      const end = (ok: boolean, errorCode?: string): void => {
        opts.emit({ type: "tool_end", callId, tool: call.name, ok, ms: Date.now() - started, ...(errorCode ? { errorCode } : {}) });
      };

      if (call.name === MODE_TOOL && opts.mode === "ask") {
        opts.emit({ type: "needs_mode" });
        reply(JSON.stringify({ shown_to_user: true, note: "The user was offered to switch to interactive mode." }));
        clarified = true;
        end(true);
        continue;
      }

      if (call.name === LOAD_TOOLS) {
        const parsed = loadSchema.safeParse(call.args);
        if (parsed.success) {
          active.add(parsed.data.section);
          const names = opts.tools.filter((t) => sectionOf(t.name) === parsed.data.section).map((t) => t.name);
          reply(JSON.stringify({ loaded: parsed.data.section, tools: names, note: names.length ? "These tools are now available." : "You have no permission for this section's tools." }));
          end(true);
        } else {
          reply(toolError("INVALID_INPUT"));
          end(false, "INVALID_INPUT");
        }
        continue;
      }

      if (call.name === WITHDRAW_TOOL) {
        const parsed = withdrawSchema.safeParse(call.args);
        if (parsed.success && waiting.has(parsed.data.id)) {
          waiting.delete(parsed.data.id);
          proposedIds.delete(parsed.data.id);
          withdrawn.push(parsed.data.id);
          reply(JSON.stringify({ withdrawn: parsed.data.id, note: "The card is withdrawn; it will not run." }));
          end(true);
        } else {
          reply(toolError("UNKNOWN_REFERENCE", parsed.success ? parsed.data.id : undefined));
          end(false, "UNKNOWN_REFERENCE");
        }
        continue;
      }
      if (call.name === CLARIFY_TOOL) {
        const parsed = clarifySchema.safeParse(call.args);
        if (parsed.success) {
          opts.emit({ type: "clarify", question: parsed.data.question, options: parsed.data.options });
          reply(JSON.stringify({ shown_to_user: true, note: "Wait for the user's choice." }));
          clarified = true;
          end(true);
        } else {
          reply(toolError("INVALID_ARGUMENTS", parsed.error.message));
          end(false, "INVALID_ARGUMENTS");
        }
        continue;
      }

      const tool = byName.get(call.name);
      if (!tool) { reply(toolError("UNKNOWN_TOOL")); end(false, "UNKNOWN_TOOL"); continue; }
      // Defence in depth: the tool list was already filtered, but check again at the moment of use.
      if (!(await opts.ctx.can(tool.permission.resource, tool.permission.action))) {
        reply(toolError("FORBIDDEN")); end(false, "FORBIDDEN"); continue;
      }
      try {
        if (tool.kind === "read") {
          const input = tool.input.safeParse(call.args);
          if (!input.success) { reply(toolError("INVALID_ARGUMENTS", input.error.message)); end(false, "INVALID_ARGUMENTS"); continue; }
          const result = await tool.run(opts.ctx, input.data);
          if (result.display) opts.emit({ type: "display", block: result.display });
          reply(wrapUntrusted(result.data));
          end(true);
          continue;
        }

        // Write tool. Validate the shape first, with $ref values allowed through as strings.
        const refs = refsIn(call.args);
        const unknownRef = refs.find((r) => !proposedIds.has(r) && !knownResults.has(r));
        if (unknownRef) { reply(toolError("UNKNOWN_REFERENCE", unknownRef)); end(false, "UNKNOWN_REFERENCE"); continue; }
        const pendingRef = refs.some((r) => !knownResults.has(r));
        const args = (call.args ?? {}) as Record<string, unknown>;
        const resolvedForCheck = pendingRef ? args : (resolveRefs(args, knownResults) as Record<string, unknown>);
        const input = tool.input.safeParse(resolvedForCheck);
        if (!input.success && !pendingRef) { reply(toolError("INVALID_ARGUMENTS", input.error.message)); end(false, "INVALID_ARGUMENTS"); continue; }
        const preview = await tool.preview(opts.ctx, input.success ? input.data : args);

        if (!pendingRef && !needsApproval(tool, opts.mode, opts.autoAllowed)) {
          const result: WriteResult = await tool.execute(opts.ctx, input.data);
          const id = `c${nextItem++}`;
          const item: ExecutedItem = { id, tool: tool.name, args, result, auto: true };
          knownResults.set(id, result.data);
          executed.push(item);
          opts.emit({ type: "executed", item });
          reply(JSON.stringify({ status: "EXECUTED", id, result: wrapUntrusted(result.data) }));
          end(true);
          continue;
        }

        const id = `c${nextItem++}`;
        const item: ProposedItem = { id, toolCallId: callId, tool: tool.name, args, preview, risk: tool.risk, dependsOn: refs };
        proposedIds.add(id);
        proposals.push(item);
        opts.emit({ type: "proposed", item });
        // The card's warnings go back to the model so it can tell the user the real problem (and fix it)
        // instead of guessing one.
        const warnings = item.preview.warningKeys ?? [];
        reply(JSON.stringify({
          status: "PROPOSED",
          id,
          note: warnings.length
            ? `Proposed, but the card shows problems: ${warnings.join(", ")}. Tell the user exactly these problems in plain words and propose a corrected version; do not ask them to approve this one.`
            : `Waiting for the user's approval on the card. Later calls may use "$ref:${id}.id".`,
          ...(warnings.length ? { warnings } : {}),
        }));
        end(true);
      } catch (error) {
        const code = error instanceof UnresolvedRefError ? "UNKNOWN_REFERENCE" : errorCode(error);
        // Domain errors (with a code) carry a message written for people; anything else stays generic.
        reply(toolError(code, code !== "TOOL_FAILED" && error instanceof Error ? error.message.slice(0, 300) : undefined));
        end(false, code);
      }
    }
    return { messages: out, proposals, executed, clarified, withdrawn };
  };

  const graph = new StateGraph(State)
    .addNode("agent", agent)
    .addNode("tools", tools)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (s: S) => ((lastAi(s.messages)?.tool_calls?.length ?? 0) > 0 && s.steps <= maxSteps ? "tools" : END))
    .addConditionalEdges("tools", (s: S) => (s.clarified || s.steps >= maxSteps ? END : "agent"))
    .compile();

  const final = (await graph.invoke({ messages: [...opts.messages] }, { recursionLimit: maxSteps * 2 + 4, ...(opts.signal ? { signal: opts.signal } : {}) }));
  // The run ended without a final plain-text answer from the model (and not because it asked a question).
  const last = final.messages[final.messages.length - 1];
  const hitStepLimit = !final.clarified && !(last instanceof AIMessage && (last.tool_calls?.length ?? 0) === 0);
  if (hitStepLimit) opts.emit({ type: "step_limit" });
  return {
    newMessages: final.messages.slice(startLength),
    proposals: final.proposals,
    executed: final.executed,
    usage: { input: final.inputTokens, output: final.outputTokens },
    stoppedForClarify: final.clarified,
    hitStepLimit,
    withdrawn: final.withdrawn,
  };
}

// usage_metadata is typed per provider in LangChain 1.x; read it structurally.
function usageOf(chunk: unknown): TokenUsage {
  const u = (chunk as { usage_metadata?: { input_tokens?: unknown; output_tokens?: unknown } } | undefined)?.usage_metadata;
  return { input: typeof u?.input_tokens === "number" ? u.input_tokens : 0, output: typeof u?.output_tokens === "number" ? u.output_tokens : 0 };
}

// Domain errors from core services carry a `code`; anything else is reported generically so no
// internal detail (SQL, stack) reaches the model or the user.
export function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "TOOL_FAILED";
}
