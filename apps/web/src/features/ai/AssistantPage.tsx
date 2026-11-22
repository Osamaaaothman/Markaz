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

  // The assistant fills everything under the top bar, edge to edge: its height is the viewport minus
  // wherever the page starts (the top bar's height differs between design directions and screen sizes).
  useLayoutEffect(() => {
    const fit = (): void => {
      const el = ref.current;
      if (!el) return;
      el.style.height = `${Math.max(window.innerHeight - el.getBoundingClientRect().top - window.scrollY, 420)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
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
