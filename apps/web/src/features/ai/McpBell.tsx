import { OverlayPanel } from "primereact/overlaypanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { formatDateTime } from "../../shared/lib/format-date";
import { useMcpActivity, type McpActivityItem } from "./ai-api";
import { useAiStore } from "./ai-store";
import { playChime, readChimePreference, readLastSeen, writeChimePreference, writeLastSeen } from "./mcp-chime";
import { McpCardDialog } from "./McpCardDialog";

const STATUS_ICON: Record<string, string> = {
  PROPOSED: "pi pi-hourglass",
  EXECUTED: "pi pi-check",
  REJECTED: "pi pi-times",
  SKIPPED: "pi pi-forward",
  FAILED: "pi pi-exclamation-triangle",
};

// "2 minutes ago" in the interface language; older than a day shows the date and time.
function relativeTime(iso: string, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return formatDateTime(iso, locale);
}

// Top-bar bell for what an external AI app (any MCP client) sent: cards waiting for approval and changes it
// saved. It polls, shows a count of unseen items, and chimes when a new one arrives while the app is open.
export function McpBell(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const perms = usePermissions();
  const { data: user } = useCurrentUser();
  const enabled = perms.can("ai_assistant:use");
  const activity = useMcpActivity(enabled);
  const panelRef = useRef<OverlayPanel>(null);
  const openPanel = useAiStore((s) => s.openPanel);
  const [card, setCard] = useState<{ conversationId: string; key: string } | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  // What was unseen when the panel was opened, so those rows keep their dot while it stays open.
  const [highlightAfter, setHighlightAfter] = useState<string | null>(null);
  const [chime, setChime] = useState(readChimePreference);
  const [ringing, setRinging] = useState(false);
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
    if (loaded.current && newest !== null && (newestKnown.current === null || newest > newestKnown.current)) {
      playChime();
      setRinging(true);
    }
    loaded.current = true;
    if (newest !== null) newestKnown.current = newest;
  }, [items, activity.isSuccess]);

  if (!enabled || items.length === 0) return null;
  const isUnseen = (item: McpActivityItem, after: string | null): boolean => after === null || item.createdAt > after;
  const unseen = items.filter((i) => isUnseen(i, lastSeen)).length;
  const waiting = items.filter((i) => i.status === "PROPOSED").length;
  const markSeen = (): void => {
    const newest = items[0]?.createdAt;
    if (!user || !newest) return;
    setHighlightAfter(lastSeen);
    writeLastSeen(user.id, newest);
    setLastSeen(newest);
    setRinging(false);
  };
  // A notification opens its card in a dialog (approve / edit / reject) without leaving the page.
  const open = (item: McpActivityItem): void => {
    panelRef.current?.hide();
    setCard({ conversationId: item.conversationId, key: item.key });
  };

  return (
    <>
      <button
        type="button"
        className={`erp-topbar__icon-button ai-mcp-bell${ringing ? " is-ringing" : ""}`}
        onClick={(e) => { panelRef.current?.toggle(e); markSeen(); }}
        aria-label={t("ai.mcpBell.open", { count: unseen })}
        title={t("ai.mcpBell.title")}
      >
        <i className="pi pi-bell" aria-hidden="true" />
        {unseen > 0 ? <span className="ai-mcp-bell__badge">{unseen > 9 ? "9+" : unseen}</span> : null}
      </button>
      <OverlayPanel ref={panelRef} className="ai-mcp-panel">
        <header className="ai-mcp-panel__head">
          <span className="ai-mcp-panel__logo" aria-hidden="true"><i className="pi pi-sparkles" /></span>
          <div className="ai-mcp-panel__heading">
            <strong>{t("ai.mcpBell.title")}</strong>
            <small>{waiting > 0 ? t("ai.mcpBell.waiting", { count: waiting }) : t("ai.mcpBell.allDone")}</small>
          </div>
          <button
            type="button"
            className={`ai-mcp-panel__sound${chime ? " is-on" : ""}`}
            onClick={() => { const on = !chime; setChime(on); writeChimePreference(on); }}
            aria-pressed={chime}
            aria-label={chime ? t("ai.mcpBell.soundOff") : t("ai.mcpBell.soundOn")}
            title={chime ? t("ai.mcpBell.soundOff") : t("ai.mcpBell.soundOn")}
          >
            <i className={chime ? "pi pi-volume-up" : "pi pi-volume-off"} aria-hidden="true" />
          </button>
        </header>
        <ul className="ai-mcp-panel__list">
          {items.map((item) => {
            const status = item.status.toLowerCase();
            return (
              <li key={item.id}>
                <button type="button" className={`ai-mcp-item ai-mcp-item--${status}`} onClick={() => open(item)}>
                  <span className="ai-mcp-item__icon" aria-hidden="true"><i className={STATUS_ICON[item.status] ?? "pi pi-circle"} /></span>
                  <span className="ai-mcp-item__body">
                    <span className="ai-mcp-item__title">{item.titleKey ? t(item.titleKey, { defaultValue: item.tool }) : item.tool}</span>
                    <span className="ai-mcp-item__meta">
                      <span className={`ai-mcp-item__status ai-mcp-item__status--${status}`}>{t(`ai.mcpBell.status.${item.status}`, { defaultValue: item.status })}</span>
                      <span className="ai-mcp-item__sep" aria-hidden="true">·</span>
                      <bdi className="ai-mcp-item__token">{item.tokenName}</bdi>
                      <span className="ai-mcp-item__sep" aria-hidden="true">·</span>
                      <span className="ai-mcp-item__time" title={formatDateTime(item.createdAt, i18n.language)}>{relativeTime(item.createdAt, i18n.language)}</span>
                    </span>
                  </span>
                  {isUnseen(item, highlightAfter) ? <span className="ai-mcp-item__dot" aria-label={t("ai.mcpBell.new")} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="ai-mcp-panel__foot">
          <button type="button" onClick={() => { panelRef.current?.hide(); openPanel(); }}>
            <i className="pi pi-comments" aria-hidden="true" /> {t("ai.mcpBell.openAssistant")}
          </button>
        </footer>
      </OverlayPanel>
      <McpCardDialog target={card} onClose={() => setCard(null)} />
    </>
  );
}
