import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ScriptedChatModel } from "../testing/scripted-model.js";
import { toolsForMode } from "../tools/policy.js";
import { defineReadTool, defineWriteTool, type ErpTool, type ToolContext } from "../tools/types.js";
import { runAssistant, type RunOptions } from "./assistant-graph.js";
import { executeDecisions } from "./change-set.js";
import { compactionCut, estimateTokens, summarizeForCompaction } from "./compaction.js";
import type { AssistantEvent } from "./events.js";

const created: Array<{ tool: string; input: unknown }> = [];

const searchParties = defineReadTool({
  name: "parties_search",
  description: "Search parties",
  input: z.object({ query: z.string() }),
  permission: { resource: "party", action: "read" },
  run: (_ctx, input) => Promise.resolve({
    data: [{ id: "p1", name: `Match for ${input.query}` }],
    display: { kind: "links", titleKey: "ai.blocks.parties", items: [{ label: "P-1", path: "/parties/p1" }] },
  }),
});

const createSupplier = defineWriteTool({
  name: "parties_createSupplier",
  description: "Create supplier",
  input: z.object({ name: z.string().min(1) }),
  permission: { resource: "party", action: "create" },
  risk: "low",
  preview: (_ctx, input) => Promise.resolve({ titleKey: "ai.preview.createSupplier", entity: "party", fields: [{ labelKey: "name", value: input.name }] }),
  execute: (_ctx, input) => { created.push({ tool: "supplier", input }); return Promise.resolve({ data: { id: "sup-1", ref: "S-0001" } }); },
});

const createEmployee = defineWriteTool({
  name: "hr_createEmployee",
  description: "Create employee",
  input: z.object({ name: z.string(), basicSalary: z.string().regex(/^\d+(\.\d{1,4})?$/), partyId: z.string().optional() }),
  permission: { resource: "employee", action: "create" },
  risk: "low",
  preview: (_ctx, input) => Promise.resolve({ titleKey: "ai.preview.createEmployee", entity: "employee", fields: [{ labelKey: "salary", value: String(input.basicSalary) }] }),
  execute: (_ctx, input) => { created.push({ tool: "employee", input }); return Promise.resolve({ data: { id: "emp-1", ref: "EMP-0001" } }); },
});

const postPayment = defineWriteTool({
  name: "payments_post",
  description: "Post a payment",
  input: z.object({ amount: z.string() }),
  permission: { resource: "payment", action: "create" },
  risk: "high",
  preview: () => Promise.resolve({ titleKey: "ai.preview.payment", entity: "payment", fields: [] }),
  execute: () => Promise.resolve({ data: { id: "pay-1" } }),
});

const allTools: ErpTool[] = [searchParties, createSupplier, createEmployee, postPayment];

function ctx(denied: string[] = []): ToolContext {
  return {
    actor: { userId: "u1", companyId: "co1" },
    locale: "ar",
    conversationId: "conv1",
    correlationId: "corr1",
    can: (resource, action) => Promise.resolve(!denied.includes(`${resource}:${action}`)),
  };
}

async function run(model: ScriptedChatModel, overrides: Partial<RunOptions> = {}) {
  const events: AssistantEvent[] = [];
  const result = await runAssistant({
    model,
    tools: allTools,
    mode: "review",
    autoAllowed: false,
    ctx: ctx(),
    system: "test",
    messages: [new HumanMessage("hi")],
    firstItemNumber: 1,
    emit: (e) => events.push(e),
    ...overrides,
  });
  return { result, events };
}

beforeEach(() => { created.length = 0; });

describe("toolsForMode", () => {
  it("never offers write tools in ask mode", () => {
    expect(toolsForMode(allTools, "ask").map((t) => t.name)).toEqual(["parties_search"]);
    expect(toolsForMode(allTools, "review")).toHaveLength(4);
  });
});

describe("runAssistant", () => {
  it("runs a read tool, streams its display block, and ends with text", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "parties_search", args: { query: "النور" } }] }, { text: "وجدت عميلاً واحداً" }]);
    const { result, events } = await run(model);
    expect(events.some((e) => e.type === "display")).toBe(true);
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toContain("وجدت");
    expect(result.proposals).toHaveLength(0);
    // The tool result reached the model inside the untrusted envelope.
    const tool = result.newMessages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(JSON.stringify(tool.content)).toContain("untrusted_data");
  });

  it("proposes writes in review mode and never executes them", async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: "parties_createSupplier", args: { name: "Al Noor" } }, { name: "hr_createEmployee", args: { name: "Osama", basicSalary: "3000.00", partyId: "$ref:c1.id" } }] },
      { text: "Two changes are waiting for your review." },
    ]);
    const { result } = await run(model);
    expect(result.proposals.map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(result.proposals[1]?.dependsOn).toEqual(["c1"]);
    expect(created).toHaveLength(0);
  });

  it("auto mode runs low-risk writes at once but still asks for high-risk ones", async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: "parties_createSupplier", args: { name: "Al Noor" } }, { name: "payments_post", args: { amount: "100.00" } }] },
      { text: "done" },
    ]);
    const { result } = await run(model, { mode: "auto", autoAllowed: true });
    expect(result.executed.map((e) => e.tool)).toEqual(["parties_createSupplier"]);
    expect(result.proposals.map((p) => p.tool)).toEqual(["payments_post"]);
  });

  it("auto mode without the auto permission behaves like review", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "parties_createSupplier", args: { name: "X" } }] }, { text: "ok" }]);
    const { result } = await run(model, { mode: "auto", autoAllowed: false });
    expect(result.executed).toHaveLength(0);
    expect(result.proposals).toHaveLength(1);
  });

  it("refuses a tool the user has no permission for", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "parties_createSupplier", args: { name: "X" } }] }, { text: "no" }]);
    const { result, events } = await run(model, { ctx: ctx(["party:create"]) });
    expect(result.proposals).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", ok: false, errorCode: "FORBIDDEN" }));
  });

  it("sends validation errors back to the model instead of proposing bad data", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "hr_createEmployee", args: { name: "O", basicSalary: "three thousand" } }] }, { text: "What is the salary as a number?" }]);
    const { result, events } = await run(model);
    expect(result.proposals).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", errorCode: "INVALID_ARGUMENTS" }));
  });

  it("rejects a reference to a change that does not exist", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "hr_createEmployee", args: { name: "O", basicSalary: "1.00", partyId: "$ref:c9.id" } }] }, { text: "x" }]);
    const { events } = await run(model);
    expect(events).toContainEqual(expect.objectContaining({ errorCode: "UNKNOWN_REFERENCE" }));
  });

  it("stops the turn after a clarifying question", async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: "clarify", args: { question: "أي نوع؟", options: ["حساب", "عميل", "مورد"] } }] },
      { text: "should never be reached" },
    ]);
    const { result, events } = await run(model);
    expect(result.stoppedForClarify).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "clarify", options: ["حساب", "عميل", "مورد"] }));
    expect(model.seen).toHaveLength(1);
  });

  it("in question mode, a write request ends the turn with a switch-mode offer", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "switch_to_interactive", args: {} }] }, { text: "should never be reached" }]);
    const { result, events } = await run(model, { mode: "ask" });
    expect(events).toContainEqual({ type: "needs_mode" });
    expect(result.stoppedForClarify).toBe(true);
    expect(model.seen).toHaveLength(1);
  });

  it("the switch-mode tool does nothing outside question mode", async () => {
    const model = new ScriptedChatModel([{ toolCalls: [{ name: "switch_to_interactive", args: {} }] }, { text: "ok" }]);
    const { events } = await run(model);
    expect(events).not.toContainEqual({ type: "needs_mode" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", ok: false, errorCode: "UNKNOWN_TOOL" }));
  });

  it("stops at the step limit", async () => {
    const loop = Array.from({ length: 10 }, () => ({ toolCalls: [{ name: "parties_search", args: { query: "x" } }] }));
    const { result } = await run(new ScriptedChatModel(loop), { maxSteps: 3 });
    expect(result.hitStepLimit).toBe(true);
  });
});

describe("executeDecisions", () => {
  async function proposals() {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: "parties_createSupplier", args: { name: "Al Noor" } }, { name: "hr_createEmployee", args: { name: "Osama", basicSalary: "3000.00", partyId: "$ref:c1.id" } }] },
      { text: "ready" },
    ]);
    return (await run(model)).result.proposals;
  }

  it("runs approved items in order and resolves references", async () => {
    const items = await proposals();
    const outcomes = await executeDecisions({ items, decisions: { c1: "approve", c2: "approve" }, tools: allTools, ctx: ctx() });
    expect(outcomes.map((o) => o.status)).toEqual(["executed", "executed"]);
    expect(created[1]).toEqual({ tool: "employee", input: { name: "Osama", basicSalary: "3000.00", partyId: "sup-1" } });
  });

  it("skips an item whose dependency was rejected", async () => {
    const items = await proposals();
    const outcomes = await executeDecisions({ items, decisions: { c1: "reject", c2: "approve" }, tools: allTools, ctx: ctx() });
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "skipped"]);
    expect(created).toHaveLength(0);
  });

  it("applies the user's edit from the card and validates it again", async () => {
    const items = await proposals();
    const ok = await executeDecisions({ items, decisions: { c1: "approve", c2: "approve" }, edits: { c2: { basicSalary: "3500.00" } }, tools: allTools, ctx: ctx() });
    expect(ok[1]?.status).toBe("executed");
    expect((created[1]?.input as { basicSalary: string }).basicSalary).toBe("3500.00");
    created.length = 0;
    const bad = await executeDecisions({ items, decisions: { c1: "approve", c2: "approve" }, edits: { c2: { basicSalary: "lots" } }, tools: allTools, ctx: ctx() });
    expect(bad[1]).toEqual({ id: "c2", status: "failed", errorCode: "INVALID_ARGUMENTS" });
  });

  it("re-checks permission at execution time", async () => {
    const items = await proposals();
    const outcomes = await executeDecisions({ items, decisions: { c1: "approve", c2: "approve" }, tools: allTools, ctx: ctx(["party:create"]) });
    expect(outcomes[0]).toEqual({ id: "c1", status: "failed", errorCode: "FORBIDDEN" });
    expect(outcomes[1]?.status).toBe("skipped");
  });
});

describe("compaction", () => {
  const long = (n: number) => "x".repeat(n);
  const turn = (i: number) => [new HumanMessage(`q${i} ${long(700)}`), new AIMessage({ content: "", tool_calls: [{ id: `t${i}`, name: "parties_search", args: { query: "a" }, type: "tool_call" }] }), new ToolMessage({ content: long(700), tool_call_id: `t${i}` }), new AIMessage(`a${i} ${long(700)}`)];

  it("does nothing while the history is small", () => {
    expect(compactionCut(turn(1), { maxTokens: 10_000, keepRecentTokens: 1_000 })).toBeNull();
  });

  it("cuts at a user message and keeps a recent tail", () => {
    const history = Array.from({ length: 12 }, (_, i) => turn(i)).flat();
    const cut = compactionCut(history, { maxTokens: 3_000, keepRecentTokens: 1_500 });
    expect(cut).not.toBeNull();
    expect(history[cut!]!.getType()).toBe("human");
    expect(estimateTokens(history.slice(cut!))).toBeLessThan(estimateTokens(history));
    expect(cut!).toBeGreaterThan(0);
  });

  it("asks the model for an updated summary including the previous one", async () => {
    const model = new ScriptedChatModel([{ text: "- Created supplier PRT-000009" }]);
    const summary = await summarizeForCompaction(model, "- earlier facts", turn(1));
    expect(summary).toBe("- Created supplier PRT-000009");
    const sent = JSON.stringify(model.seen[0]?.map((m) => m.content));
    expect(sent).toContain("earlier facts");
    expect(sent).toContain("q1");
  });
});
