import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "./ai-store";
import { useOrbState } from "./orb-state";
import { AssistantOrb } from "./components/AssistantOrb";
import { ChatView } from "./components/ChatView";
import { ConversationList } from "./components/ConversationList";
import "./ai.css";

// The assistant on a full page: past conversations on the side, the chat in the middle.
export function AssistantPage(): React.JSX.Element {
  const { t } = useTranslation();
  const closePanel = useAiStore((s) => s.closePanel);
  const orb = useOrbState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { closePanel(); }, [closePanel]);

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
      el.style.height = `${Math.max(window.innerHeight - top, 420)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    const topbar = document.querySelector(".erp-topbar");
    if (topbar) observer.observe(topbar);
    window.addEventListener("resize", fit);
    return () => {
      root.style.overflow = previous;
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div ref={ref} className={`ai-page ai-surface ai-surface--${orb}`}>
      <aside className="ai-page__side">
        <div className="ai-page__brand">
          <AssistantOrb size={38} state={orb} />
          <div>
            <h1>{t("ai.panel.title")}</h1>
            <p>{t("ai.panel.subtitle")}</p>
          </div>
        </div>
        <ConversationList />
      </aside>
      <section className="ai-page__main">
        <ChatView variant="page" />
      </section>
    </div>
  );
}
