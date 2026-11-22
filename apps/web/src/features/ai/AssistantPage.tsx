import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "./ai-store";
import { useOrbState } from "./orb-state";
import { ChatView } from "./components/ChatView";
import { ConversationList } from "./components/ConversationList";
import "./ai.css";

// The assistant on a full page: past conversations on the side, the chat in the middle.
export function AssistantPage(): React.JSX.Element {
  const { t } = useTranslation();
  const closePanel = useAiStore((s) => s.closePanel);
  const orb = useOrbState();
  const historyOpen = useAiStore((s) => s.historyOpen);
  const toggleHistory = useAiStore((s) => s.toggleHistory);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { closePanel(); }, [closePanel]);
  // On a narrow screen the list covers the chat: close it once a conversation is picked.
  const closeIfNarrow = (): void => { if (window.innerWidth <= 860 && useAiStore.getState().historyOpen) toggleHistory(); };
  // On a narrow screen the list overlays the chat, so it starts closed there.
  useEffect(() => {
    if (window.innerWidth <= 860 && useAiStore.getState().historyOpen) useAiStore.getState().toggleHistory();
  }, []);

  // The assistant fills everything under the top bar, edge to edge, and the document itself never
  // scrolls while it is open: only the conversation list and the chat scroll, each inside its own column.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const fit = (): void => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // The visual viewport shrinks when a phone keyboard opens; follow it so the composer stays above the keys.
      const visible = window.visualViewport?.height ?? window.innerHeight;
      el.style.height = `${Math.max(visible - top, 320)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    // Anything above the page can change height (top bar, offline banner, design direction): refit on all of it.
    for (const selector of [".erp-topbar", ".erp-shell__main"]) {
      const el = document.querySelector(selector);
      if (el) observer.observe(el);
    }
    const attrs = new MutationObserver(fit);
    attrs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-design", "data-theme", "dir"] });
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.visualViewport?.removeEventListener("resize", fit);
      root.style.overflow = previous;
      observer.disconnect();
      attrs.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div ref={ref} className={`ai-page ai-surface ai-surface--${orb}${historyOpen ? "" : " is-collapsed"}`}>
      <aside className="ai-page__side" aria-hidden={!historyOpen}>
        <ConversationList onPicked={closeIfNarrow} />
      </aside>
      {historyOpen && <div className="ai-page__scrim" onClick={toggleHistory} aria-hidden="true" />}
      <section className="ai-page__main">
        <button
          type="button"
          className="ai-page__toggle"
          onClick={toggleHistory}
          aria-expanded={historyOpen}
          aria-label={historyOpen ? t("ai.history.hide") : t("ai.history.show")}
          title={historyOpen ? t("ai.history.hide") : t("ai.history.show")}
        >
          <i className={historyOpen ? "pi pi-angle-double-left" : "pi pi-history"} aria-hidden="true" />
        </button>
        <ChatView variant="page" />
      </section>
    </div>
  );
}
