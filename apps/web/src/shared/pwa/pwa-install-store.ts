import { create } from "zustand";

// The `beforeinstallprompt` event is not in lib.dom (Chromium-only), so it is typed here.
export interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

interface PwaInstallState {
  // Set when the browser says the app can be installed (Chromium/Edge/Android). Null elsewhere.
  readonly deferred: BeforeInstallPromptEvent | null;
  readonly installed: boolean;
  readonly setDeferred: (event: BeforeInstallPromptEvent | null) => void;
  readonly markInstalled: () => void;
}

export const usePwaInstallStore = create<PwaInstallState>((set) => ({
  deferred: null,
  installed: false,
  setDeferred: (deferred) => set({ deferred }),
  markInstalled: () => set({ deferred: null, installed: true }),
}));

let listening = false;

// Called once from main.tsx, BEFORE React renders: the browser can fire `beforeinstallprompt` before the
// first component mounts, and the event is only ever fired once per page load.
export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // we show our own prompt instead of the browser's mini-infobar
    usePwaInstallStore.getState().setDeferred(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => usePwaInstallStore.getState().markInstalled());
}
