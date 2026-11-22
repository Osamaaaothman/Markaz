import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssistantMode, ChatMessage } from "./ai-api";

// UI state of the assistant. The panel and the live conversation are shared between the side panel
// and the full page so switching between them keeps the chat. Only the chosen mode is remembered.
interface AiState {
  panelOpen: boolean;
  openPanel: (prefill?: string) => void;
  closePanel: () => void;
  togglePanel: () => void;
  prefill: string | null;
  takePrefill: () => string | null;

  mode: AssistantMode;
  setMode: (mode: AssistantMode) => void;

  conversationId: string | null;
  messages: ChatMessage[];
  status: "IDLE" | "AWAITING_APPROVAL";
  busy: boolean;
  setConversation: (id: string | null, messages: ChatMessage[], status: "IDLE" | "AWAITING_APPROVAL") => void;
  setMessages: (update: (messages: ChatMessage[]) => ChatMessage[]) => void;
  setStatus: (status: "IDLE" | "AWAITING_APPROVAL") => void;
  setBusy: (busy: boolean) => void;
  setConversationId: (id: string) => void;

  // Drives the orb: dictation in progress, and a short success/error flash after a turn.
  listening: boolean;
  setListening: (listening: boolean) => void;
  flash: "success" | "error" | null;
  flashOnce: (flash: "success" | "error") => void;

  // The composer: the unsent text survives switching between the panel and the full page; the page
  // the user is on is sent as context unless they remove the chip; ArrowUp recalls earlier messages.
  draft: string;
  setDraft: (draft: string) => void;
  includePage: boolean;
  setIncludePage: (include: boolean) => void;
  sent: string[];
  remember: (text: string) => void;

  // Full page: the conversation list column, open or collapsed (remembered on this device).
  historyOpen: boolean;
  toggleHistory: () => void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      panelOpen: false,
      openPanel: (prefill) => set({ panelOpen: true, prefill: prefill ?? null }),
      closePanel: () => set({ panelOpen: false }),
      togglePanel: () => set({ panelOpen: !get().panelOpen }),
      prefill: null,
      takePrefill: () => {
        const p = get().prefill;
        if (p !== null) set({ prefill: null });
        return p;
      },
      mode: "ask",
      setMode: (mode) => set({ mode }),
      conversationId: null,
      messages: [],
      status: "IDLE",
      busy: false,
      setConversation: (conversationId, messages, status) => set({ conversationId, messages, status }),
      setMessages: (update) => set({ messages: update(get().messages) }),
      setStatus: (status) => set({ status }),
      setBusy: (busy) => set({ busy }),
      setConversationId: (conversationId) => set({ conversationId }),
      listening: false,
      setListening: (listening) => set({ listening }),
      flash: null,
      flashOnce: (flash) => {
        clearTimeout(flashTimer);
        set({ flash });
        flashTimer = setTimeout(() => set({ flash: null }), 1600);
      },
      draft: "",
      setDraft: (draft) => set({ draft }),
      includePage: true,
      setIncludePage: (includePage) => set({ includePage }),
      sent: [],
      historyOpen: true,
      toggleHistory: () => set({ historyOpen: !get().historyOpen }),
      remember: (text) => set({ sent: [...get().sent.filter((x) => x !== text), text].slice(-20) }),
    }),
    // Only the mode is remembered: messages and drafts stay in memory, so no business text is left in browser storage.
    { name: "erp-ai-assistant", partialize: (s) => ({ mode: s.mode, historyOpen: s.historyOpen }) },
  ),
);
