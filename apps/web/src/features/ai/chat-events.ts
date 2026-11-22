import type { ChatEvent, ChatMessage } from "./ai-api";

// Applies one streamed event to the assistant message being written. Pure, so it is easy to test.
export function applyEvent(message: ChatMessage, e: ChatEvent): ChatMessage {
  switch (e.type) {
    case "token":
      return { ...message, text: (message.text ?? "") + e.text };
    case "tool_start":
      return { ...message, timeline: [...message.timeline, { callId: e.callId, tool: e.tool, running: true }] };
    case "tool_end":
      return {
        ...message,
        timeline: message.timeline.map((s) => (s.callId === e.callId ? { ...s, running: false, ok: e.ok, ms: e.ms, ...(e.errorCode ? { errorCode: e.errorCode } : {}) } : s)),
      };
    case "display":
      return { ...message, blocks: [...message.blocks, e.block] };
    case "clarify":
      return { ...message, blocks: [...message.blocks, { kind: "clarify", question: e.question, options: e.options }] };
    case "proposed":
      return {
        ...message,
        changes: [...message.changes, { key: e.item.id, tool: e.item.tool, args: e.item.args, preview: e.item.preview, risk: e.item.risk, status: "PROPOSED", auto: false, dependsOn: e.item.dependsOn, link: null, errorCode: null }],
      };
    case "executed":
      return {
        ...message,
        changes: [...message.changes, { key: e.item.id, tool: e.item.tool, args: e.item.args, preview: { titleKey: `ai.tool.${e.item.tool}`, entity: "", fields: [] }, risk: "low", status: "EXECUTED", auto: true, dependsOn: [], link: e.item.result.link ?? null, errorCode: null }],
      };
    case "step_limit":
      return { ...message, errorCode: "STEP_LIMIT" };
    case "error":
      return { ...message, errorCode: e.code };
    case "done":
      return { ...message, id: e.messageId, streaming: false };
    default:
      return message;
  }
}
