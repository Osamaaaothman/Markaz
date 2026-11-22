import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { usePermissions } from "../../../shared/auth/use-permissions";
import { useCurrentUser } from "../../../shared/auth/use-current-user";
import { useAiMe, type AssistantMode, type ChatMessage, type TimelineStep } from "../ai-api";
import { useAiStore } from "../ai-store";
import { useAssistantChat } from "../use-assistant-chat";
import { AnswerBlocks } from "./AnswerBlocks";
import { AssistantOrb } from "./AssistantOrb";
import { ChangeCards } from "./ChangeCards";
import { Composer } from "./Composer";
import { RichText } from "./RichText";

const MODES: ReadonlyArray<{ mode: AssistantMode; icon: string }> = [
  { mode: "ask", icon: "pi pi-comments" },
  { mode: "review", icon: "pi pi-check-square" },
  { mode: "auto", icon: "pi pi-bolt" },
];

// Suggestions that fit the page the user is on (feature "context awareness").
function suggestionKeys(pathname: string, mode: AssistantMode): string[] {
  const interactive = mode !== "ask";
  if (pathname.startsWith("/hr")) return interactive ? ["ai.suggest.newEmployee", "ai.suggest.findEmployee"] : ["ai.suggest.findEmployee", "ai.suggest.overview"];
  if (pathname.startsWith("/parties")) return interactive ? ["ai.suggest.newCustomer", "ai.suggest.newSupplier"] : ["ai.suggest.findCustomer", "ai.suggest.overview"];
  if (pathname.startsWith("/inventory")) return interactive ? ["ai.suggest.newItem", "ai.suggest.findItem"] : ["ai.suggest.findItem", "ai.suggest.lowStock"];
  if (pathname.startsWith("/sales")) return ["ai.suggest.salesMonth", "ai.suggest.lastInvoices"];
  if (pathname.startsWith("/accounting")) return interactive ? ["ai.suggest.newAccount", "ai.suggest.trend"] : ["ai.suggest.trend", "ai.suggest.findAccount"];
  return interactive ? ["ai.suggest.newCustomer", "ai.suggest.newEmployee", "ai.suggest.overview"] : ["ai.suggest.overview", "ai.suggest.trend", "ai.suggest.salesMonth"];
}

function Timeline({ steps }: { steps: TimelineStep[] }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const running = steps.some((s) => s.running);
  return (
    <div className={`ai-timeline${open ? " ai-timeline--open" : ""}`}>
      <button type="button" className="ai-timeline__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className={running ? "pi pi-spin pi-spinner" : "pi pi-list-check"} aria-hidden="true" />
        <span>{running ? t(`ai.tool.${steps[steps.length - 1]?.tool ?? ""}`, { defaultValue: t("ai.timeline.working") }) : t("ai.timeline.steps", { count: steps.length })}</span>
        <i className={`pi ${open ? "pi-chevron-up" : "pi-chevron-down"}`} aria-hidden="true" />
      </button>
      {open ? (
        <ol className="ai-timeline__list">
          {steps.map((s, i) => (
            <li key={s.callId ?? i} className={s.running ? "is-running" : s.ok ? "is-ok" : "is-failed"}>
              <i className={s.running ? "pi pi-spin pi-spinner" : s.ok ? "pi pi-check" : "pi pi-times"} aria-hidden="true" />
              <span>{t(`ai.tool.${s.tool}`, { defaultValue: s.tool })}</span>
              {s.ms !== undefined ? <span className="ai-timeline__ms" dir="ltr">{s.ms} ms</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Message({ m, currency, busy, onChoose, onDecide }: { m: ChatMessage; currency: string; busy: boolean; onChoose: (s: string) => void; onDecide: Parameters<typeof ChangeCards>[0]["onDecide"] }): React.JSX.Element {
  const { t } = useTranslation();
  if (m.role === "user") {
    return <div className="ai-msg ai-msg--user"><div className="ai-bubble">{m.text}</div></div>;
  }
  const thinking = m.streaming && !m.text && m.timeline.every((s) => !s.running) && m.blocks.length === 0;
  return (
    <div className="ai-msg ai-msg--assistant">
      <AssistantOrb size={26} state={m.streaming ? "thinking" : m.changes.some((c) => c.status === "PROPOSED") ? "waiting" : "idle"} />
      <div className="ai-msg__body">
        <Timeline steps={m.timeline} />
        {thinking ? <div className="ai-typing" aria-label={t("ai.timeline.working")}><span /><span /><span /></div> : null}
        <AnswerBlocks blocks={m.blocks} currency={currency} onChoose={onChoose} disabled={busy} />
        {m.text ? <div className={`ai-answer${m.streaming ? " ai-answer--streaming" : ""}`}><RichText text={m.text} /></div> : null}
        <ChangeCards changes={m.changes} busy={busy} onDecide={onDecide} />
        {m.errorCode ? <p className="ai-error"><i className="pi pi-exclamation-circle" aria-hidden="true" /> {t(`ai.error.${m.errorCode}`, { defaultValue: t("ai.error.PROVIDER_ERROR") })}</p> : null}
      </div>
    </div>
  );
}

export function ChatView({ variant }: { variant: "panel" | "page" }): React.JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const perms = usePermissions();
  const { data: user } = useCurrentUser();
  const me = useAiMe(perms.can("ai_assistant:use"));
  const { messages, busy, mode, setMode, status } = useAiStore();
  const chat = useAssistantChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currency = user?.companyDefaultCurrency ?? "SAR";

  const allowed = useMemo(
    () => ({ ask: perms.can("ai_assistant:use"), review: perms.can("ai_assistant:interact"), auto: perms.can("ai_assistant:auto") && me.data?.autoModeEnabled === true }),
    [perms, me.data],
  );
  useEffect(() => { if (!allowed[mode]) setMode("ask"); }, [allowed, mode, setMode]);

  // Keep the newest content in view while it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  if (me.data && !me.data.configured) {
    return (
      <div className="ai-empty">
        <AssistantOrb size={64} />
        <h3>{t("ai.notConfigured.title")}</h3>
        <p>{t("ai.notConfigured.body")}</p>
        {perms.can("ai_settings:manage") ? <Link className="ai-chip ai-chip--choice" to="/settings/ai">{t("ai.notConfigured.action")}</Link> : null}
      </div>
    );
  }

  const suggestions = messages.length === 0 || status === "IDLE" ? suggestionKeys(pathname, mode).map((k) => t(k)) : [];

  return (
    <div className={`ai-chat ai-chat--${variant} ai-chat--mode-${mode}`}>
      <div className="ai-modes" role="radiogroup" aria-label={t("ai.mode.label")}>
        {MODES.map(({ mode: m, icon }) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={!allowed[m] || busy}
            className={`ai-mode${mode === m ? " ai-mode--active" : ""} ai-mode--${m}`}
            onClick={() => setMode(m)}
            title={allowed[m] ? t(`ai.mode.${m}Hint`) : t("ai.mode.notAllowed")}
          >
            <i className={icon} aria-hidden="true" /> <span>{t(`ai.mode.${m}`)}</span>
          </button>
        ))}
      </div>

      <div className="ai-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <AssistantOrb size={variant === "page" ? 88 : 64} />
            <h3>{t("ai.welcome.title")}</h3>
            <p>{t(`ai.welcome.${mode}`)}</p>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} m={m} currency={currency} busy={busy} onChoose={chat.send} onDecide={chat.decide} />)
        )}
      </div>

      <Composer busy={busy} onSend={chat.send} onStop={chat.stop} suggestions={suggestions.slice(0, 3)} />
      {me.data ? (
        <p className="ai-footnote">
          {t("ai.footnote", { model: me.data.model ?? "—" })}
        </p>
      ) : null}
    </div>
  );
}
