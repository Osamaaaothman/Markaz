import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { aiKeys, ChatHttpError, fetchConversation, stopConversation, streamChat, type ChatEvent, type ChatMessage, type DisplayBlock } from "./ai-api";
import { applyEvent } from "./chat-events";
import { useAiStore } from "./ai-store";
import { looksLikeWrite } from "./write-intent";

let tempId = 0;
// Conversations whose running turn this tab is already waiting for (one poll loop each).
const following = new Set<string>();
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const localId = (): string => `local-${Date.now()}-${tempId++}`;

export function useAssistantChat() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const store = useAiStore;

  const locale = i18n.language === "ar" ? "ar" : "en";

  const run = useCallback(
    async (path: string, body: Record<string, unknown> | FormData, userText: string | null, userBlocks: DisplayBlock[] = []) => {
      const s = store.getState();
      if (s.busy) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const assistant: ChatMessage = { id: localId(), role: "assistant", text: "", blocks: [], timeline: [], errorCode: null, changes: [], streaming: true };
      s.setBusy(true);
      s.setMessages((m) => [...m, ...(userText !== null ? [{ id: localId(), role: "user" as const, text: userText, blocks: userBlocks, timeline: [], errorCode: null, changes: [] }] : []), assistant]);
      const update = (e: ChatEvent): void => {
        // The orb flashes green when something was really saved, red on an error.
        if (e.type === "error") store.getState().flashOnce("error");
        if (e.type === "executed" || (e.type === "outcome" && e.outcome.status === "EXECUTED")) store.getState().flashOnce("success");
        if (e.type === "conversation") { store.getState().setConversationId(e.id); return; }
        if (e.type === "compacted") {
          // Show the divider just above the message that triggered it.
          store.getState().setMessages((list) => {
            const at = list.map((m) => m.role).lastIndexOf("user");
            const divider: ChatMessage = { id: localId(), role: "divider", text: null, blocks: [], timeline: [], errorCode: null, changes: [] };
            return at < 0 ? [...list, divider] : [...list.slice(0, at), divider, ...list.slice(at)];
          });
          return;
        }
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
    (text: string, opts: { force?: boolean; file?: File } = {}) => {
      const s = store.getState();
      const trimmed = text.trim();
      if (!trimmed || s.busy) return;
      // Question mode cannot change data: offer the switch at once instead of a slow refusal.
      if (s.mode === "ask" && !opts.force && !opts.file && looksLikeWrite(trimmed)) {
        s.remember(trimmed);
        const base = { blocks: [], timeline: [], errorCode: null, changes: [] };
        s.setMessages((m) => [...m, { ...base, id: localId(), role: "user", text: trimmed }, { ...base, id: localId(), role: "assistant", text: null, blocks: [{ kind: "needsMode", text: trimmed }] }]);
        return;
      }
      // Leaving proposals unanswered rejects them on the server; show that right away.
      if (s.status === "AWAITING_APPROVAL") {
        s.setMessages((list) => list.map((m) => ({ ...m, changes: m.changes.map((c) => (c.status === "PROPOSED" ? { ...c, status: "REJECTED" as const } : c)) })));
        s.setStatus("IDLE");
      }
      s.remember(trimmed);
      const entityId = /\/([0-9a-f]{8}-[0-9a-f-]{27,})$/.exec(location.pathname)?.[1];
      const payload = { text: trimmed, mode: s.mode, locale, ...(s.conversationId ? { conversationId: s.conversationId } : {}), ...(s.includePage ? { page: { route: location.pathname, ...(entityId ? { entityId } : {}) } } : {}) };
      if (opts.file) {
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        form.append("file", opts.file, opts.file.name);
        void run("/v1/ai/messages/file", form, trimmed, [{ kind: "upload", name: opts.file.name, contentType: opts.file.type, sizeBytes: opts.file.size }]);
        return;
      }
      void run("/v1/ai/messages", payload, trimmed);
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

  const stop = useCallback(() => {
    abortRef.current?.abort();
    const id = store.getState().conversationId;
    if (id) void stopConversation(id).catch(() => undefined);
  }, [store]);

  // The server is still answering (the page was refreshed or reopened mid-turn): show it as working
  // and poll until the answer is saved, then show the saved conversation.
  const follow = useCallback(
    async (id: string) => {
      if (following.has(id)) return;
      following.add(id);
      const s = store.getState();
      s.setBusy(true);
      s.setMessages((m) => [...m, { id: localId(), role: "assistant", text: "", blocks: [], timeline: [], errorCode: null, changes: [], streaming: true }]);
      try {
        for (;;) {
          await sleep(1500);
          if (store.getState().conversationId !== id) return;
          const detail = await fetchConversation(id);
          if (detail.conversation.running) continue;
          if (store.getState().conversationId === id) store.getState().setConversation(id, detail.messages, detail.conversation.status);
          return;
        }
      } catch {
        // Network trouble: stop waiting; reopening the conversation resumes.
      } finally {
        following.delete(id);
        store.getState().setBusy(false);
        void qc.invalidateQueries({ queryKey: aiKeys.conversations });
      }
    },
    [qc, store],
  );

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
      if (detail.conversation.running) void follow(id);
    },
    [follow, store],
  );

  // Switch to interactive (review) mode and send the request again there.
  const switchAndSend = useCallback(
    (text: string) => {
      store.getState().setMode("review");
      send(text, { force: true });
    },
    [send, store],
  );

  return { send, switchAndSend, decide, stop, newChat, openConversation };
}
