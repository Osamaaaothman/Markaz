import { type BaseMessage, mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages, type StoredMessage, ToolMessage } from "@langchain/core/messages";

// LangChain's own (de)serialisation, so provider extras survive a round trip through the database
// (Gemini 3 rejects a follow-up turn if the "thought signature" of an earlier tool call is lost).
export function toStored(messages: readonly BaseMessage[]): StoredMessage[] {
  return mapChatMessagesToStoredMessages([...messages]);
}

export function fromStored(stored: readonly unknown[]): BaseMessage[] {
  return mapStoredMessagesToChatMessages(stored as StoredMessage[]);
}

// Long conversations cost tokens on every turn. Keep the most recent messages, never starting the
// window on a tool result (a tool result without the AI call that asked for it is rejected by
// every provider).
export function trimHistory(messages: readonly BaseMessage[], max = 40): BaseMessage[] {
  if (messages.length <= max) return [...messages];
  let start = messages.length - max;
  while (start < messages.length && messages[start]?.getType() !== "human") start++;
  return messages.slice(start);
}

// Data a tool returned in an EARLIER turn was already used for that turn's answer, yet it would be
// resent in full (up to 12k characters each) on every later call. Keep only its start; the model can
// call the tool again whenever it needs the full data. Results of the current turn are untouched.
export const OLD_RESULT_CHARS = 600;

export function shrinkOldToolResults(messages: readonly BaseMessage[], keep = OLD_RESULT_CHARS): BaseMessage[] {
  let lastHuman = -1;
  messages.forEach((m, i) => { if (m.getType() === "human") lastHuman = i; });
  return messages.map((m, i) => {
    if (i >= lastHuman || !(m instanceof ToolMessage) || typeof m.content !== "string" || m.content.length <= keep) return m;
    return new ToolMessage({
      content: `${m.content.slice(0, keep)}… [earlier result shortened; call the tool again for the full data]`,
      tool_call_id: m.tool_call_id,
      ...(m.name ? { name: m.name } : {}),
      ...(m.id ? { id: m.id } : {}),
    });
  });
}
