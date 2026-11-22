import { Sidebar } from "primereact/sidebar";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../../shared/auth/use-permissions";
import { useAiStore } from "./ai-store";
import { useOrbState } from "./orb-state";
import { AssistantOrb } from "./components/AssistantOrb";
import { ChatView } from "./components/ChatView";
import { ConversationList } from "./components/ConversationList";
import "./ai.css";

// The assistant as a side panel available on every screen (Ctrl/⌘ + J, or the ✨ button in the top bar).
// It opens on the inline-end side, so it flips with the text direction.
export function AssistantPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const perms = usePermissions();
  const open = useAiStore((s) => s.panelOpen);
  const close = useAiStore((s) => s.closePanel);
  const orb = useOrbState();
  const [history, setHistory] = useState(false);
  const allowed = perms.can("ai_assistant:use");

  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        useAiStore.getState().togglePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed]);

  if (!allowed) return null;

  return (
    <Sidebar
      visible={open}
      onHide={close}
      // PrimeReact mirrors the side itself under dir="rtl", so "right" means inline-end in both directions.
      position="right"
      className="ai-panel"
      showCloseIcon={false}
      blockScroll={false}
      modal={false}
      dismissable
      ariaCloseLabel={t("ai.panel.close")}
      content={() => (
        <div className={`ai-panel__inner ai-surface ai-surface--${orb}`}>
          <div className="ai-aurora" aria-hidden="true"><i /><i /><i /></div>
          <header className="ai-panel__head">
            <AssistantOrb size={34} state={orb} />
            <div className="ai-panel__titles">
              <strong>{t("ai.panel.title")}</strong>
              <span key={orb} className="ai-panel__status">{t(`ai.orb.${orb}`)}</span>
            </div>
            <span className="ai-panel__spacer" />
            <button type="button" className={`ai-icon-btn${history ? " ai-icon-btn--on" : ""}`} onClick={() => setHistory(!history)} aria-label={t("ai.history.title")} title={t("ai.history.title")}>
              <i className="pi pi-history" aria-hidden="true" />
            </button>
            <button type="button" className="ai-icon-btn" onClick={() => { close(); void navigate("/assistant"); }} aria-label={t("ai.panel.expand")} title={t("ai.panel.expand")}>
              <i className="pi pi-window-maximize" aria-hidden="true" />
            </button>
            <button type="button" className="ai-icon-btn" onClick={close} aria-label={t("ai.panel.close")} title={t("ai.panel.close")}>
              <i className="pi pi-times" aria-hidden="true" />
            </button>
          </header>
          {history ? <ConversationList onPicked={() => setHistory(false)} /> : <ChatView variant="panel" />}
        </div>
      )}
    />
  );
}

// The ✨ button for the top bar.
export function AssistantButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const perms = usePermissions();
  const toggle = useAiStore((s) => s.togglePanel);
  const orb = useOrbState();
  if (!perms.can("ai_assistant:use")) return null;
  return (
    <button type="button" className={`ai-topbar-btn ai-topbar-btn--${orb}`} onClick={toggle} aria-label={t("ai.panel.open")} title={`${t("ai.panel.open")} (Ctrl J)`}>
      <AssistantOrb size={22} state={orb} />
      <span>{t("ai.panel.short")}</span>
    </button>
  );
}
