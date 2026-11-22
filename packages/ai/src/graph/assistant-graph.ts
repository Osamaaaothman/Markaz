import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type AIMessageChunk, type BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
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
}

export interface RunResult {
  readonly newMessages: BaseMessage[];
  readonly proposals: ProposedItem[];
  readonly executed: ExecutedItem[];
  readonly usage: TokenUsage;
  readonly stoppedForClarify: boolean;
  readonly hitStepLimit: boolean;
}

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  proposals: Annotation<ProposedItem[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  executed: Annotation<ExecutedItem[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  steps: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  inputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  outputTokens: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  clarified: Annotation<boolean>({ reducer: (a, b) => a || b, default: () => false }),
});
type S = typeof State.State;

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: unknown) => (p !== null && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
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
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const llmTools = [
    ...opts.tools.map((t) => ({ name: t.name, description: t.description, schema: t.input })),
    { name: CLARIFY_TOOL, description: "Ask the user to choose between options when the request is ambiguous. Ends your turn.", schema: clarifySchema },
  ];
  if (typeof opts.model.bindTools !== "function") throw new Error("MODEL_HAS_NO_TOOL_SUPPORT");
  const bound = opts.model.bindTools(llmTools);
  const knownResults = new Map(opts.priorResults ?? []);
  const proposedIds = new Set<string>();
  let nextItem = opts.firstItemNumber;
  const startLength = opts.messages.length;

  const agent = async (state: S): Promise<Partial<S>> => {
    let full: AIMessageChunk | undefined;
    const stream = await bound.stream([new SystemMessage(opts.system), ...state.messages], opts.signal ? { signal: opts.signal } : {});
    for await (const chunk of stream) {
      const text = textOf(chunk.content);
      if (text) opts.emit({ type: "token", text });
      full = full ? concat(full, chunk) : chunk;
    }
    // TS cannot see the assignment inside the for-await loop, so re-type it explicitly.
    const res = full as AIMessageChunk | undefined;
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
    let clarified = false;
    for (const call of ai?.tool_calls ?? []) {
      const callId = call.id ?? `call_${out.length}`;
      const reply = (content: string): void => { out.push(new ToolMessage({ content, tool_call_id: callId, name: call.name })); };
      const started = Date.now();
      opts.emit({ type: "tool_start", callId, tool: call.name });
      const end = (ok: boolean, errorCode?: string): void => {
        opts.emit({ type: "tool_end", callId, tool: call.name, ok, ms: Date.now() - started, ...(errorCode ? { errorCode } : {}) });
      };

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
        reply(JSON.stringify({ status: "PROPOSED", id, note: `Waiting for the user's approval. Later calls may use "$ref:${id}.id".` }));
        end(true);
      } catch (error) {
        const code = error instanceof UnresolvedRefError ? "UNKNOWN_REFERENCE" : errorCode(error);
        reply(toolError(code));
        end(false, code);
      }
    }
    return { messages: out, proposals, executed, clarified };
  };

  const graph = new StateGraph(State)
    .addNode("agent", agent)
    .addNode("tools", tools)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (s: S) => ((lastAi(s.messages)?.tool_calls?.length ?? 0) > 0 && s.steps <= maxSteps ? "tools" : END))
    .addConditionalEdges("tools", (s: S) => (s.clarified || s.steps >= maxSteps ? END : "agent"))
    .compile();

  const final = (await graph.invoke({ messages: [...opts.messages] }, { recursionLimit: maxSteps * 2 + 4, ...(opts.signal ? { signal: opts.signal } : {}) })) as S;
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
