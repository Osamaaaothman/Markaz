import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssistantMode } from "../ai-api";
import { useAiStore } from "../ai-store";
import { ModeSwitch } from "./ModeSwitch";

// Web Speech API types are not in TypeScript's DOM lib; this is the small part we use.
interface SpeechResultEvent { readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }> & { readonly isFinal: boolean }> }
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Slash commands: "/" at the start of the box opens a menu of ready-made requests.
interface SlashCommand { readonly id: string; readonly icon: string; readonly mode?: AssistantMode; readonly send?: boolean }
const COMMANDS: readonly SlashCommand[] = [
  { id: "overview", icon: "pi pi-chart-pie", send: true },
  { id: "trend", icon: "pi pi-chart-bar", send: true },
  { id: "invoices", icon: "pi pi-file", send: true },
  { id: "lowStock", icon: "pi pi-box", send: true },
  { id: "customer", icon: "pi pi-user-plus", mode: "review" },
  { id: "supplier", icon: "pi pi-truck", mode: "review" },
  { id: "employee", icon: "pi pi-id-card", mode: "review" },
  { id: "item", icon: "pi pi-tag", mode: "review" },
  { id: "new", icon: "pi pi-plus-circle" },
];

export interface ComposerProps {
  readonly busy: boolean;
  readonly mode: AssistantMode;
  readonly allowed: Record<AssistantMode, boolean>;
  readonly suggestions: string[];
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onMode: (mode: AssistantMode) => void;
  readonly onNewChat: () => void;
}

// The input capsule: a glowing border while focused or working, the mode switch inside it, "/" commands,
// dictation into the box (never sent by itself), Enter to send, Shift+Enter for a new line, Esc to stop.
export function Composer({ busy, mode, allowed, suggestions, onSend, onStop, onMode, onNewChat }: ComposerProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const listening = useAiStore((s) => s.listening);
  const setListening = useAiStore((s) => s.setListening);
  const prefill = useAiStore((s) => s.prefill);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const canDictate = recognitionCtor() !== null;

  useEffect(() => {
    if (prefill === null) return;
    setText(useAiStore.getState().takePrefill() ?? "");
    ref.current?.focus();
  }, [prefill]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => () => recRef.current?.stop(), []);

  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const commands = useMemo(() => {
    if (slashQuery === undefined) return [];
    const q = slashQuery.toLowerCase();
    return COMMANDS.filter((c) => (!c.mode || allowed[c.mode]) && `${c.id} ${t(`ai.slash.${c.id}.label`)}`.toLowerCase().includes(q));
  }, [slashQuery, allowed, t]);
  useEffect(() => setActive(0), [slashQuery]);

  const submit = (): void => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  const pick = (c: SlashCommand | undefined): void => {
    if (!c) return;
    if (c.id === "new") { setText(""); onNewChat(); return; }
    if (c.mode && mode === "ask") onMode(c.mode);
    const prompt = t(`ai.slash.${c.id}.prompt`);
    if (c.send) { setText(""); onSend(prompt); return; }
    setText(prompt);
    ref.current?.focus();
  };

  const dictate = (): void => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Ctor();
    rec.lang = i18n.language === "ar" ? "ar-SA" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    const before = text ? `${text} ` : "";
    rec.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i]?.[0]?.transcript ?? "";
      setText(before + heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div className="ai-composer">
      {commands.length > 0 ? (
        <div className="ai-slash" role="listbox" aria-label={t("ai.slash.title")}>
          <div className="ai-slash__title">{t("ai.slash.title")}</div>
          {commands.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ai-slash__item${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
            >
              <span className="ai-slash__icon"><i className={c.icon} aria-hidden="true" /></span>
              <span className="ai-slash__text">
                <strong>/{t(`ai.slash.${c.id}.label`)}</strong>
                <small>{t(`ai.slash.${c.id}.hint`)}</small>
              </span>
              {c.mode ? <span className="ai-slash__mode"><i className="pi pi-check-square" aria-hidden="true" /></span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 && !text ? (
        <div className="ai-suggestions">
          {suggestions.map((s, i) => (
            <button key={s} type="button" className="ai-suggestion" style={{ animationDelay: `${i * 70}ms` }} disabled={busy} onClick={() => onSend(s)}>
              <i className="pi pi-sparkles" aria-hidden="true" /> {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`ai-capsule${focused ? " is-focused" : ""}${busy ? " is-busy" : ""}${listening ? " is-listening" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={listening ? t("ai.composer.listening") : t(`ai.composer.placeholder_${mode}`)}
          aria-label={t("ai.composer.placeholder")}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (commands.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % commands.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + commands.length) % commands.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(commands[active]); return; }
              if (e.key === "Escape") { e.preventDefault(); setText(""); return; }
            }
            if (e.key === "Escape" && busy) { e.preventDefault(); onStop(); return; }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          maxLength={4000}
        />
        <div className="ai-capsule__bar">
          <ModeSwitch compact mode={mode} allowed={allowed} disabled={busy} onChange={onMode} />
          <span className="ai-capsule__spacer" />
          {text.length > 3500 ? <span className="ai-capsule__count" dir="ltr">{text.length}/4000</span> : null}
          {canDictate ? (
            <button type="button" className={`ai-round ai-round--ghost${listening ? " is-live" : ""}`} onClick={dictate} aria-label={t("ai.composer.dictate")} title={t("ai.composer.dictate")}>
              <i className="pi pi-microphone" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={`ai-round ai-round--send${busy ? " is-stop" : ""}`}
            onClick={busy ? onStop : submit}
            disabled={!busy && !text.trim()}
            aria-label={busy ? t("ai.composer.stop") : t("ai.composer.send")}
            title={busy ? `${t("ai.composer.stop")} (Esc)` : t("ai.composer.send")}
          >
            <i className={busy ? "pi pi-stop" : "pi pi-arrow-up"} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="ai-composer__hint">{t("ai.composer.hint")}</p>
    </div>
  );
}
