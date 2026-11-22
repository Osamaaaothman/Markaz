import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent } from "./chat-events.ts";

const empty = () => ({ id: "local-1", role: "assistant", text: "", blocks: [], timeline: [], errorCode: null, changes: [], streaming: true });

test("tokens append to the answer in order", () => {
  let m = empty();
  for (const text of ["مر", "حباً"]) m = applyEvent(m, { type: "token", text });
  assert.equal(m.text, "مرحباً");
});

test("a tool step starts running and ends with its result", () => {
  let m = applyEvent(empty(), { type: "tool_start", callId: "a", tool: "parties_search" });
  assert.equal(m.timeline[0].running, true);
  m = applyEvent(m, { type: "tool_end", callId: "a", tool: "parties_search", ok: false, ms: 12, errorCode: "FORBIDDEN" });
  assert.deepEqual(m.timeline[0], { callId: "a", tool: "parties_search", running: false, ok: false, ms: 12, errorCode: "FORBIDDEN" });
});

test("a proposal becomes a waiting card and an auto-executed change a saved one", () => {
  let m = applyEvent(empty(), { type: "proposed", item: { id: "c1", tool: "hr_createEmployee", args: { basicSalary: "3000.00" }, preview: { titleKey: "t", entity: "employee", fields: [] }, risk: "low", dependsOn: [] } });
  m = applyEvent(m, { type: "executed", item: { id: "c2", tool: "parties_createCustomer", args: {}, result: { data: { id: "x" }, link: { label: "PRT-1", path: "/parties" } } } });
  assert.deepEqual(m.changes.map((c) => [c.key, c.status, c.auto]), [["c1", "PROPOSED", false], ["c2", "EXECUTED", true]]);
  assert.deepEqual(m.changes[1].link, { label: "PRT-1", path: "/parties" });
});

test("clarify questions and display blocks are shown as blocks", () => {
  let m = applyEvent(empty(), { type: "display", block: { kind: "links", titleKey: "k", items: [] } });
  m = applyEvent(m, { type: "clarify", question: "أي نوع؟", options: ["عميل", "مورد"] });
  assert.deepEqual(m.blocks.map((b) => b.kind), ["links", "clarify"]);
});

test("done takes the server id and stops streaming; errors are kept", () => {
  let m = applyEvent(empty(), { type: "error", code: "RATE_LIMITED" });
  m = applyEvent(m, { type: "done", messageId: "srv-9", status: "IDLE", usage: { input: 1, output: 1 } });
  assert.equal(m.id, "srv-9");
  assert.equal(m.streaming, false);
  assert.equal(m.errorCode, "RATE_LIMITED");
});
