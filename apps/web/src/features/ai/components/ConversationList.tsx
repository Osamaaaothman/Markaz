import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../shared/lib/format-date";
import { useConversations, useDeleteConversation, useUpdateConversation } from "../ai-api";
import { useAiStore } from "../ai-store";
import { useAssistantChat } from "../use-assistant-chat";

// The user's past chats: pinned first, then newest. Only the owner ever sees a conversation.
export function ConversationList({ onPicked }: { onPicked?: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const list = useConversations(true);
  const update = useUpdateConversation();
  const remove = useDeleteConversation();
  const activeId = useAiStore((s) => s.conversationId);
  const chat = useAssistantChat();

  return (
    <div className="ai-history">
      <button type="button" className="ai-history__new" onClick={() => { chat.newChat(); onPicked?.(); }}>
        <i className="pi pi-plus" aria-hidden="true" /> {t("ai.history.new")}
      </button>
      {list.data?.length === 0 ? <p className="ai-history__empty">{t("ai.history.empty")}</p> : null}
      <ul>
        {list.data?.map((c) => (
          <li key={c.id} className={c.id === activeId ? "is-active" : undefined}>
            <button type="button" className="ai-history__item" onClick={() => { void chat.openConversation(c.id); onPicked?.(); }}>
              <span className="ai-history__title">
                {c.pinned ? <i className="pi pi-thumbtack" aria-hidden="true" /> : null}
                {c.status === "AWAITING_APPROVAL" ? <span className="ai-dot" title={t("ai.history.waiting")} /> : null}
                {c.title}
              </span>
              <span className="ai-history__meta">{t(`ai.mode.${c.mode}`)} · {formatDateTime(c.updatedAt, i18n.language)}</span>
            </button>
            <span className="ai-history__actions">
              <button type="button" className="ai-icon-btn" onClick={() => update.mutate({ id: c.id, pinned: !c.pinned })} aria-label={c.pinned ? t("ai.history.unpin") : t("ai.history.pin")} title={c.pinned ? t("ai.history.unpin") : t("ai.history.pin")}>
                <i className="pi pi-thumbtack" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ai-icon-btn ai-icon-btn--danger"
                onClick={() => {
                  if (!window.confirm(t("ai.history.confirmDelete"))) return;
                  remove.mutate(c.id, { onSuccess: () => { if (c.id === activeId) chat.newChat(); } });
                }}
                aria-label={t("ai.history.delete")}
                title={t("ai.history.delete")}
              >
                <i className="pi pi-trash" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
