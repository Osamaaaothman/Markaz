import { useEffect } from "react";
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
  useEffect(() => { closePanel(); }, [closePanel]);

  return (
    <div className={`ai-page ai-surface ai-surface--${orb}`}>
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
        <div className="ai-aurora" aria-hidden="true"><i /><i /><i /></div>
        <ChatView variant="page" />
      </section>
    </div>
  );
}
