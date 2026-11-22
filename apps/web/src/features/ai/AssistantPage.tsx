import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "./ai-store";
import { AssistantOrb } from "./components/AssistantOrb";
import { ChatView } from "./components/ChatView";
import { ConversationList } from "./components/ConversationList";
import "./ai.css";

// The assistant on a full page: past conversations on the side, the chat in the middle.
export function AssistantPage(): React.JSX.Element {
  const { t } = useTranslation();
  const closePanel = useAiStore((s) => s.closePanel);
  useEffect(() => { closePanel(); }, [closePanel]);

  return (
    <div className="ai-page">
      <aside className="ai-page__side">
        <div className="ai-page__brand">
          <AssistantOrb size={34} />
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
