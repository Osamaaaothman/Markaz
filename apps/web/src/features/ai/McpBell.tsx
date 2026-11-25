import { InputSwitch } from "primereact/inputswitch";
import { OverlayPanel } from "primereact/overlaypanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatDateTime } from "../../shared/lib/format-date";
import { useMcpActivity } from "./ai-api";
import { useAiStore } from "./ai-store";
import { playChime, readChimePreference, readLastSeen, writeChimePreference, writeLastSeen } from "./mcp-chime";
import { useAssistantChat } from "./use-assistant-chat";

// Top-bar bell for what Claude (an external MCP client) sent: cards waiting for approval and changes it
// saved. It polls, shows a count of unseen items, and chimes when a new one arrives while the app is open.
export function McpBell(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const perms = usePermissions();
  const { data: user } = useCurrentUser();
  const enabled = perms.can("ai_assistant:use");
  const activity = useMcpActivity(enabled);
  const panelRef = useRef<OverlayPanel>(null);
  const openPanel = useAiStore((s) => s.openPanel);
  const chat = useAssistantChat();
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [chime, setChime] = useState(readChimePreference);
  // The newest item already known; only items newer than it ring the bell (never the first load,
  // but the very first item does ring when the list was empty before).
  const newestKnown = useRef<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (user) setLastSeen(readLastSeen(user.id));
  }, [user]);

  const items = useMemo(() => activity.data ?? [], [activity.data]);
  useEffect(() => {
    if (!activity.isSuccess) return;
    const newest = items[0]?.createdAt ?? null;
    if (loaded.current && newest !== null && (newestKnown.current === null || newest > newestKnown.current)) playChime();
    loaded.current = true;
    if (newest !== null) newestKnown.current = newest;
  }, [items, activity.isSuccess]);

  if (!enabled || items.length === 0) return null;
  const unseen = items.filter((i) => lastSeen === null || i.createdAt > lastSeen).length;
  const markSeen = (): void => {
    const newest = items[0]?.createdAt;
    if (!user || !newest) return;
    writeLastSeen(user.id, newest);
    setLastSeen(newest);
  };

  return (
    <>
      <button
        type="button"
        className="erp-topbar__icon-button ai-mcp-bell"
        onClick={(e) => { panelRef.current?.toggle(e); markSeen(); }}
        aria-label={t("ai.mcpBell.open", { count: unseen })}
        title={t("ai.mcpBell.title")}
      >
        <i className="pi pi-bell" aria-hidden="true" />
        {unseen > 0 ? <span className="ai-mcp-bell__badge">{unseen > 9 ? "9+" : unseen}</span> : null}
      </button>
      <OverlayPanel ref={panelRef} className="ai-mcp-bell__panel">
        <div className="ai-mcp-bell__head">
          <strong>{t("ai.mcpBell.title")}</strong>
          <label className="ai-mcp-bell__sound">
            <span>{t("ai.mcpBell.sound")}</span>
            <InputSwitch checked={chime} onChange={(e) => { const on = Boolean(e.value); setChime(on); writeChimePreference(on); }} />
          </label>
        </div>
        <ul className="ai-mcp-bell__list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="ai-mcp-bell__item"
                onClick={() => {
                  panelRef.current?.hide();
                  openPanel();
                  void chat.openConversation(item.conversationId);
                }}
              >
                <span className={`ai-mcp-bell__status ai-mcp-bell__status--${item.status.toLowerCase()}`}>{t(`ai.mcpBell.status.${item.status}`, { defaultValue: item.status })}</span>
                <span className="ai-mcp-bell__what">{item.titleKey ? t(item.titleKey, { defaultValue: item.tool }) : item.tool}</span>
                <small><bdi>{item.tokenName}</bdi> · <bdi>{formatDateTime(item.createdAt, i18n.language)}</bdi></small>
              </button>
            </li>
          ))}
        </ul>
      </OverlayPanel>
    </>
  );
}
