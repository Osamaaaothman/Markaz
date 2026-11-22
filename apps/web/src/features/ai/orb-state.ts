import { useAiStore } from "./ai-store";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "waiting" | "success" | "error";

// One place decides how the assistant "looks" right now, so the top-bar button, the panel header and
// the newest message always agree.
export function useOrbState(): OrbState {
  return useAiStore((s) => {
    if (s.listening) return "listening";
    if (s.flash) return s.flash;
    if (s.busy) {
      const last = s.messages[s.messages.length - 1];
      return last?.streaming && last.text ? "speaking" : "thinking";
    }
    return s.status === "AWAITING_APPROVAL" ? "waiting" : "idle";
  });
}
