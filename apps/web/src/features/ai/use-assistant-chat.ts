import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { aiKeys, ChatHttpError, fetchConversation, streamChat, type ChatEvent, type ChatMessage } from "./ai-api";
import { applyEvent } from "./chat-events";
import { useAiStore } from "./ai-store";

let tempId = 0;
const localId = (): string => `local-${Date.now()}-${tempId++}`;

export function useAssistantChat() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const store = useAiStore;

  const locale = i18n.language === "ar" ? "ar" : "en";

  const run = useCallback(
    async (path: string, body: Record<string, unknown>, userText: string | null) => {
      const s = store.getState();
      if (s.busy) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const assistant: ChatMessage = { id: localId(), role: "assistant", text: "", blocks: [], timeline: [], errorCode: null, changes: [], streaming: true };
      s.setBusy(true);
      s.setMessages((m) => [...m, ...(userText !== null ? [{ id: localId(), role: "user" as const, text: userText, blocks: [], timeline: [], errorCode: null, changes: [] }] : []), assistant]);
      const update = (e: ChatEvent): void => {
        // The orb flashes green when something was really saved, red on an error.
        if (e.type === "error") store.getState().flashOnce("error");
        if (e.type === "executed" || (e.type === "outcome" && e.outcome.status === "EXECUTED")) store.getState().flashOnce("success");
        if (e.type === "conversation") { store.getState().setConversationId(e.id); return; }
        if (e.type === "outcome") {
          // Outcomes update the cards of an earlier message.
          store.getState().setMessages((list) =>
            list.map((msg) => ({
              ...msg,
              changes: msg.changes.map((c) => (c.key === e.outcome.key ? { ...c, status: e.outcome.status, link: e.outcome.link ?? c.link, errorCode: e.outcome.errorCode ?? null } : c)),
            })),
          );
          return;
        }
        if (e.type === "done") store.getState().setStatus(e.status);
        store.getState().setMessages((list) => list.map((msg) => (msg.id === assistant.id || (msg.streaming && msg.role === "assistant") ? applyEvent(msg, e) : msg)));
        if (e.type === "done") assistant.id = e.messageId;
      };
      try {
        await streamChat(path, body, update, controller.signal);
      } catch (error) {
        const aborted = controller.signal.aborted;
        const code = aborted ? "ABORTED" : error instanceof ChatHttpError ? error.code : "NETWORK";
        store.getState().setMessages((list) => list.map((msg) => (msg.streaming ? { ...msg, streaming: false, errorCode: aborted && msg.text ? null : code } : msg)));
      } finally {
        store.getState().setMessages((list) => list.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)));
        store.getState().setBusy(false);
        abortRef.current = null;
        void qc.invalidateQueries({ queryKey: aiKeys.conversations });
        void qc.invalidateQueries({ queryKey: aiKeys.me });
      }
    },
    [qc, store],
  );

  const send = useCallback(
    (text: string) => {
      const s = store.getState();
      const trimmed = text.trim();
      if (!trimmed) return;
      // Leaving proposals unanswered rejects them on the server; show that right away.
      if (s.status === "AWAITING_APPROVAL") {
        s.setMessages((list) => list.map((m) => ({ ...m, changes: m.changes.map((c) => (c.status === "PROPOSED" ? { ...c, status: "REJECTED" as const } : c)) })));
        s.setStatus("IDLE");
      }
      const entityId = /\/([0-9a-f]{8}-[0-9a-f-]{27,})$/.exec(location.pathname)?.[1];
      void run(
        "/v1/ai/messages",
        { text: trimmed, mode: s.mode, locale, ...(s.conversationId ? { conversationId: s.conversationId } : {}), page: { route: location.pathname, ...(entityId ? { entityId } : {}) } },
        trimmed,
      );
    },
    [locale, location.pathname, run, store],
  );

  const decide = useCallback(
    (decisions: Record<string, "approve" | "reject">, edits?: Record<string, Record<string, unknown>>) => {
      const id = store.getState().conversationId;
      if (!id) return;
      store.getState().setStatus("IDLE");
      void run(`/v1/ai/conversations/${id}/decisions`, { decisions, locale, ...(edits && Object.keys(edits).length ? { edits } : {}) }, null);
    },
    [locale, run, store],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    store.getState().setConversation(null, [], "IDLE");
  }, [store]);

  const openConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      const detail = await fetchConversation(id);
      store.getState().setConversation(id, detail.messages, detail.conversation.status);
      store.getState().setMode(detail.conversation.mode);
    },
    [store],
  );

  return { send, decide, stop, newChat, openConversation };
}
