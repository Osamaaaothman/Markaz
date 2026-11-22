import { type BaseMessage, mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages, type StoredMessage } from "@langchain/core/messages";

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
