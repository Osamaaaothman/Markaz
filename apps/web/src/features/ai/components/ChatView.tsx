import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { usePermissions } from "../../../shared/auth/use-permissions";
import { useCurrentUser } from "../../../shared/auth/use-current-user";
import { copyToClipboard } from "../../../shared/lib/copy-to-clipboard";
import { useAiMe, type AssistantMode, type ChatMessage, type TimelineStep } from "../ai-api";
import { useAiStore } from "../ai-store";
import { useOrbState } from "../orb-state";
import { useAssistantChat } from "../use-assistant-chat";
import { AnswerBlocks } from "./AnswerBlocks";
import { AssistantOrb } from "./AssistantOrb";
import { ChangeCards } from "./ChangeCards";
import { Composer } from "./Composer";
import { RichText } from "./RichText";

// Suggestions that fit the page the user is on (context awareness).
function suggestionKeys(pathname: string, mode: AssistantMode): string[] {
  const interactive = mode !== "ask";
  if (pathname.startsWith("/hr")) return interactive ? ["ai.suggest.newEmployee", "ai.suggest.findEmployee"] : ["ai.suggest.findEmployee", "ai.suggest.overview"];
  if (pathname.startsWith("/parties")) return interactive ? ["ai.suggest.newCustomer", "ai.suggest.newSupplier"] : ["ai.suggest.findCustomer", "ai.suggest.overview"];
  if (pathname.startsWith("/inventory")) return interactive ? ["ai.suggest.newItem", "ai.suggest.findItem"] : ["ai.suggest.findItem", "ai.suggest.lowStock"];
  if (pathname.startsWith("/sales")) return ["ai.suggest.salesMonth", "ai.suggest.whoOwes", "ai.suggest.lastInvoices"];
  if (pathname.startsWith("/purchasing")) return ["ai.suggest.pendingPo", "ai.suggest.overview"];
  if (pathname.startsWith("/accounting")) return interactive ? ["ai.suggest.newAccount", "ai.suggest.profit"] : ["ai.suggest.profit", "ai.suggest.trend", "ai.suggest.whoOwes"];
  return interactive ? ["ai.suggest.newCustomer", "ai.suggest.newEmployee", "ai.suggest.overview"] : ["ai.suggest.overview", "ai.suggest.profit", "ai.suggest.lowStock"];
}

// What the assistant is doing right now, as a single shimmering line ("Searching customers…").
function LiveStatus({ steps }: { steps: TimelineStep[] }): React.JSX.Element {
  const { t } = useTranslation();
  const running = [...steps].reverse().find((s) => s.running);
  const label = running ? t(`ai.tool.${running.tool}`, { defaultValue: t("ai.timeline.working") }) : t("ai.timeline.thinking");
  return (
    <p className="ai-live" aria-live="polite">
      <span className="ai-loader" aria-hidden="true"><i /><i /><i /></span>
      <span className="ai-live__text">{label}</span>
    </p>
  );
}

// The tools used for an answer, as small pills; collapsed to a summary once done.
function Steps({ steps, live }: { steps: TimelineStep[]; live: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const total = steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  if (!live && !open) {
    const failed = steps.filter((s) => s.ok === false).length;
    return (
      <button type="button" className="ai-steps-summary" onClick={() => setOpen(true)}>
        <i className={failed ? "pi pi-exclamation-circle" : "pi pi-check-circle"} aria-hidden="true" />
        {t("ai.timeline.steps", { count: steps.length })} · <span dir="ltr">{total < 1000 ? `${total}ms` : `${(total / 1000).toFixed(1)}s`}</span>
        <i className="pi pi-chevron-down" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="ai-steps">
      {steps.map((s, i) => (
        <span key={s.callId ?? i} className={`ai-step ${s.running ? "is-running" : s.ok ? "is-ok" : "is-failed"}`} style={{ animationDelay: `${i * 50}ms` }}>
          <span className="ai-step__dot">{s.running ? <i className="pi pi-spin pi-spinner" aria-hidden="true" /> : <i className={s.ok ? "pi pi-check" : "pi pi-times"} aria-hidden="true" />}</span>
          {t(`ai.tool.${s.tool}`, { defaultValue: s.tool })}
          {s.ms !== undefined ? <small dir="ltr">{s.ms}ms</small> : null}
        </span>
      ))}
      {!live ? <button type="button" className="ai-steps__close" onClick={() => setOpen(false)} aria-label={t("ai.timeline.hide")}><i className="pi pi-chevron-up" aria-hidden="true" /></button> : null}
    </div>
  );
}

function MessageActions({ m, canRetry, onRetry }: { m: ChatMessage; canRetry: boolean; onRetry: () => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (m.streaming) return null;
  return (
    <div className="ai-actions">
      {m.text ? (
        <button
          type="button"
          className="ai-action"
          onClick={() => { void copyToClipboard(m.text ?? "").then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }); }}
          title={t("ai.actions.copy")}
          aria-label={t("ai.actions.copy")}
        >
          <i className={copied ? "pi pi-check" : "pi pi-copy"} aria-hidden="true" />
          <span>{copied ? t("ai.actions.copied") : t("ai.actions.copy")}</span>
        </button>
      ) : null}
      {canRetry ? (
        <button type="button" className="ai-action" onClick={onRetry} title={t("ai.actions.retry")} aria-label={t("ai.actions.retry")}>
          <i className="pi pi-refresh" aria-hidden="true" /> <span>{t("ai.actions.retry")}</span>
        </button>
      ) : null}
    </div>
  );
}

function Message({ m, last, currency, busy, onChoose, onDecide, onRetry }: { m: ChatMessage; last: boolean; currency: string; busy: boolean; onChoose: (s: string) => void; onDecide: Parameters<typeof ChangeCards>[0]["onDecide"]; onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const orb = useOrbState();
  if (m.role === "user") {
    return <div className="ai-msg ai-msg--user"><div className="ai-bubble">{m.text}</div></div>;
  }
  const waiting = m.streaming && !m.text && m.blocks.length === 0 && m.changes.length === 0;
  // Only the newest answer is "alive"; older ones rest (or stay red if they failed).
  const state = last ? orb : m.errorCode ? "error" : "idle";
  return (
    <div className={`ai-msg ai-msg--assistant${m.streaming ? " is-streaming" : ""}`}>
      <div className="ai-msg__rail">
        <AssistantOrb size={30} state={state} />
      </div>
      <div className="ai-msg__body">
        <div className="ai-msg__name">{t("ai.panel.title")}</div>
        <Steps steps={m.timeline} live={Boolean(m.streaming)} />
        {waiting ? <LiveStatus steps={m.timeline} /> : null}
        <AnswerBlocks blocks={m.blocks} currency={currency} onChoose={onChoose} disabled={busy} />
        {m.text ? <div className={`ai-answer${m.streaming ? " ai-answer--streaming" : ""}`}><RichText text={m.text} /></div> : null}
        <ChangeCards changes={m.changes} busy={busy} onDecide={onDecide} />
        {m.errorCode && m.errorCode !== "ABORTED" ? (
          <div className="ai-error">
            <i className="pi pi-exclamation-triangle" aria-hidden="true" />
            <span>{t(`ai.error.${m.errorCode}`, { defaultValue: t("ai.error.PROVIDER_ERROR") })}</span>
          </div>
        ) : null}
        <MessageActions m={m} canRetry={last && !busy} onRetry={onRetry} />
      </div>
    </div>
  );
}

const CAPABILITIES: ReadonlyArray<{ id: string; icon: string; mode: AssistantMode }> = [
  { id: "numbers", icon: "pi pi-chart-pie", mode: "ask" },
  { id: "trend", icon: "pi pi-chart-line", mode: "ask" },
  { id: "create", icon: "pi pi-user-plus", mode: "review" },
  { id: "find", icon: "pi pi-search", mode: "ask" },
];

function Welcome({ variant, allowed, onPick }: { variant: "panel" | "page"; allowed: Record<AssistantMode, boolean>; onPick: (prompt: string, mode: AssistantMode) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const mode = useAiStore((s) => s.mode);
  const orb = useOrbState();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("ai.welcome.morning") : hour < 18 ? t("ai.welcome.afternoon") : t("ai.welcome.evening");
  const name = user?.email.split("@")[0] ?? "";
  return (
    <div className={`ai-welcome ai-welcome--${variant}`}>
      <div className="ai-welcome__stage">
        <AssistantOrb size={variant === "page" ? 120 : 92} state={orb} />
      </div>
      <h2 className="ai-welcome__title">
        <span>{name ? t("ai.welcome.greeting", { greeting, name }) : greeting}</span>
        <strong>{t("ai.welcome.title")}</strong>
      </h2>
      <p className="ai-welcome__sub">{t(`ai.welcome.${mode}`)}</p>
      <div className="ai-cards">
        {CAPABILITIES.filter((c) => allowed[c.mode]).map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`ai-card ai-card--${c.id}`}
            style={{ animationDelay: `${120 + i * 80}ms` }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
              e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
            }}
            onClick={() => onPick(t(`ai.cards.${c.id}.prompt`), c.mode)}
          >
            <span className="ai-card__icon"><i className={c.icon} aria-hidden="true" /></span>
            <strong>{t(`ai.cards.${c.id}.title`)}</strong>
            <span>{t(`ai.cards.${c.id}.example`)}</span>
            {c.mode !== "ask" ? <em className="ai-card__tag">{t("ai.mode.review")}</em> : null}
          </button>
        ))}
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
  const [atBottom, setAtBottom] = useState(true);
  const currency = user?.companyDefaultCurrency ?? "SAR";

  const allowed = useMemo<Record<AssistantMode, boolean>>(
    () => ({ ask: perms.can("ai_assistant:use"), review: perms.can("ai_assistant:interact"), auto: perms.can("ai_assistant:auto") && me.data?.autoModeEnabled === true }),
    [perms, me.data],
  );
  useEffect(() => { if (!allowed[mode]) setMode("ask"); }, [allowed, mode, setMode]);

  // Follow the newest content while it streams, unless the user scrolled up to read. Instant, not smooth:
  // a smooth scroll per streamed token queues up and fights the user's own scrolling.
  const stickRef = useRef(true);
  const lastCount = useRef(messages.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length === 0) { el.scrollTop = 0; stickRef.current = true; setAtBottom(true); return; }
    // A new message (the user sent something, or a conversation was opened) always jumps to the end.
    if (messages.length !== lastCount.current) stickRef.current = true;
    lastCount.current = messages.length;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (me.data && !me.data.configured) {
    return (
      <div className="ai-welcome">
        <div className="ai-welcome__stage"><AssistantOrb size={92} state="waiting" /></div>
        <h2 className="ai-welcome__title"><strong>{t("ai.notConfigured.title")}</strong></h2>
        <p className="ai-welcome__sub">{t("ai.notConfigured.body")}</p>
        {perms.can("ai_settings:manage") ? <Link className="ai-suggestion" to="/settings/ai"><i className="pi pi-cog" aria-hidden="true" /> {t("ai.notConfigured.action")}</Link> : null}
      </div>
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const streaming = messages[messages.length - 1];
  const runningTool = streaming?.streaming ? [...streaming.timeline].reverse().find((x) => x.running) : undefined;
  const liveLabel = !busy ? null : runningTool ? t(`ai.tool.${runningTool.tool}`, { defaultValue: t("ai.timeline.working") }) : streaming?.text ? t("ai.orb.speaking") : t("ai.timeline.thinking");
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const suggestions = messages.length > 0 && status === "IDLE" && !busy ? suggestionKeys(pathname, mode).map((k) => t(k)).slice(0, 3) : [];
  const pickCard = (prompt: string, m: AssistantMode): void => {
    if (m !== "ask" && mode === "ask") setMode(m);
    chat.send(prompt);
  };

  return (
    <div className={`ai-chat ai-chat--${variant} ai-chat--mode-${mode}`}>
      <div
        className="ai-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          stickRef.current = bottom;
          setAtBottom(bottom);
        }}
      >
        {messages.length === 0 ? (
          <Welcome variant={variant} allowed={allowed} onPick={pickCard} />
        ) : (
          <div className="ai-thread">
            {messages.map((m) => (
              <Message key={m.id} m={m} last={m.id === lastAssistantId} currency={currency} busy={busy} onChoose={chat.send} onDecide={chat.decide} onRetry={() => { if (lastUser?.text) chat.send(lastUser.text); }} />
            ))}
          </div>
        )}
      </div>

      {!atBottom && messages.length > 0 ? (
        <button type="button" className="ai-jump" onClick={() => { const el = scrollRef.current; if (el) { stickRef.current = true; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); } }} aria-label={t("ai.actions.latest")}>
          <i className="pi pi-arrow-down" aria-hidden="true" />
        </button>
      ) : null}

      <Composer busy={busy} mode={mode} allowed={allowed} suggestions={suggestions} liveLabel={liveLabel} onSend={chat.send} onStop={chat.stop} onMode={setMode} onNewChat={chat.newChat} />
      {me.data?.model ? <p className="ai-footnote">{t("ai.footnote", { model: me.data.model })}</p> : null}
    </div>
  );
}
