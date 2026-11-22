import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { NAV_ITEMS } from "../../../app/layout/NavConfig";
import type { AssistantMode } from "../ai-api";
import { useAiStore } from "../ai-store";
import { startAudioMeter, type AudioMeter } from "../audio-meter";
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

// Slash commands: "/" at the start of the box (or the / button) opens a menu of ready-made requests.
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

// The page the user is on, as a readable label (longest matching sidebar entry).
function usePageLabel(): string | null {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const match = [...NAV_ITEMS]
    .filter((n) => (n.to === "/" ? pathname === "/" : pathname === n.to || pathname.startsWith(`${n.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!match || match.to === "/assistant") return null;
  return t(match.labelKey);
}

export interface ComposerProps {
  readonly busy: boolean;
  readonly mode: AssistantMode;
  readonly allowed: Record<AssistantMode, boolean>;
  readonly suggestions: string[];
  readonly liveLabel: string | null;
  readonly onSend: (text: string, opts?: { file?: File }) => void;
  readonly onStop: () => void;
  readonly onMode: (mode: AssistantMode) => void;
  readonly onNewChat: () => void;
}

// The input capsule:
//  - a context chip for the page you are on (remove it to ask without page context)
//  - "/" commands (typed or from the button), a hint when a pasted list will become several records
//  - dictation into the box with a live dot wave (never sent by itself)
//  - ArrowUp on an empty box recalls earlier messages; Enter sends, Shift+Enter new line, Esc stops
//  - while the assistant works, what it is doing is shown inside the bar
//  - the unsent text survives switching between the panel and the full page
// What the server accepts (it checks the bytes again): PDF and the common picture types, 10 MB at most.
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function Composer({ busy, mode, allowed, suggestions, liveLabel, onSend, onStop, onMode, onNewChat }: ComposerProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const text = useAiStore((s) => s.draft);
  const setText = useAiStore((s) => s.setDraft);
  const includePage = useAiStore((s) => s.includePage);
  const setIncludePage = useAiStore((s) => s.setIncludePage);
  const sent = useAiStore((s) => s.sent);
  const listening = useAiStore((s) => s.listening);
  const setListening = useAiStore((s) => s.setListening);
  const prefill = useAiStore((s) => s.prefill);
  const pageLabel = usePageLabel();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recall, setRecall] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const takeFile = (f: File | undefined): void => {
    if (!f) return;
    if (!FILE_TYPES.includes(f.type)) { setFile(null); setFileError("ai.composer.fileType"); return; }
    if (f.size > MAX_FILE_BYTES) { setFile(null); setFileError("ai.composer.fileTooLarge"); return; }
    setFileError(null);
    setFile(f);
  };
  const recRef = useRef<Recognition | null>(null);
  const meterRef = useRef<AudioMeter | null>(null);
  const canDictate = recognitionCtor() !== null;

  useEffect(() => {
    if (prefill === null) return;
    setText(useAiStore.getState().takePrefill() ?? "");
    ref.current?.focus();
  }, [prefill, setText]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => () => { recRef.current?.stop(); meterRef.current?.stop(); }, []);

  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const showMenu = slashQuery !== undefined || menuOpen;
  const commands = useMemo(() => {
    if (!showMenu) return [];
    const q = (slashQuery ?? "").toLowerCase();
    return COMMANDS.filter((c) => (!c.mode || allowed[c.mode]) && `${c.id} ${t(`ai.slash.${c.id}.label`)}`.toLowerCase().includes(q));
  }, [showMenu, slashQuery, allowed, t]);
  useEffect(() => setActive(0), [slashQuery, menuOpen]);

  const lines = text.split("\n").filter((l) => l.trim()).length;
  const pctUsed = text.length / 4000;

  const submit = (): void => {
    if (busy || (!text.trim() && !file)) return;
    if (file) onSend(text.trim() || t("ai.composer.fileOnly"), { file });
    else onSend(text);
    setFile(null);
    setFileError(null);
    setText("");
    setRecall(null);
  };

  const pick = (c: SlashCommand | undefined): void => {
    setMenuOpen(false);
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
    const finish = (): void => {
      setListening(false);
      meterRef.current?.stop();
      meterRef.current = null;
    };
    rec.onend = finish;
    rec.onerror = finish;
    recRef.current = rec;
    setListening(true);
    rec.start();
    void startAudioMeter((level) => useAiStore.getState().setAudioLevel(level)).then((meter) => {
      // Dictation may already have ended while the microphone permission was being asked.
      if (!useAiStore.getState().listening) meter?.stop();
      else meterRef.current = meter;
    });
  };

  return (
    <div className="ai-composer">
      {commands.length > 0 ? (
        <div className="ai-slash" role="listbox" aria-label={t("ai.slash.title")}>
          <div className="ai-slash__title">
            <span>{t("ai.slash.title")}</span>
            <span className="ai-kbd-row"><kbd>↑</kbd><kbd>↓</kbd><kbd>Enter</kbd></span>
          </div>
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
              {c.mode ? <span className="ai-slash__mode">{t("ai.mode.review")}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 && !text ? (
        <div className="ai-suggestions">
          {suggestions.map((s, i) => (
            <button key={s} type="button" className="ai-suggestion" style={{ animationDelay: `${i * 70}ms` }} disabled={busy} onClick={() => onSend(s)}>
              <i className="pi pi-arrow-up-left" aria-hidden="true" /> {s}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={`ai-capsule${focused ? " is-focused" : ""}${busy ? " is-busy" : ""}${listening ? " is-listening" : ""}`}
        onClick={() => ref.current?.focus()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); takeFile(e.dataTransfer.files[0]); } }}
      >
        {(pageLabel || file || fileError || (lines >= 3 && mode !== "ask")) ? (
          <div className="ai-capsule__top">
            {file ? (
              <span className="ai-ctx ai-ctx--file" title={t("ai.composer.fileHint")}>
                <i className={file.type === "application/pdf" ? "pi pi-file-pdf" : "pi pi-image"} aria-hidden="true" />
                <span dir="auto">{file.name}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }} aria-label={t("ai.composer.removeFile")}>
                  <i className="pi pi-times" aria-hidden="true" />
                </button>
              </span>
            ) : null}
            {fileError ? <span className="ai-ctx ai-ctx--error" role="alert"><i className="pi pi-exclamation-triangle" aria-hidden="true" /> {t(fileError)}</span> : null}
            {pageLabel ? (
              includePage ? (
                <span className="ai-ctx" title={t("ai.composer.pageContextHint")}>
                  <i className="pi pi-map-marker" aria-hidden="true" />
                  <span>{pageLabel}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setIncludePage(false); }} aria-label={t("ai.composer.removeContext")}>
                    <i className="pi pi-times" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <button type="button" className="ai-ctx ai-ctx--off" onClick={(e) => { e.stopPropagation(); setIncludePage(true); }}>
                  <i className="pi pi-plus" aria-hidden="true" /> {t("ai.composer.addContext", { page: pageLabel })}
                </button>
              )
            ) : null}
            {lines >= 3 && mode !== "ask" ? (
              <span className="ai-ctx ai-ctx--info"><i className="pi pi-list" aria-hidden="true" /> {t("ai.composer.batchHint", { count: lines })}</span>
            ) : null}
          </div>
        ) : null}

        {listening ? (
          <div className="ai-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * -0.12 - Math.floor(i / 6) * 0.05}s` }} />)}</div>
        ) : null}

        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={listening ? t("ai.composer.listening") : t(`ai.composer.placeholder_${mode}`)}
          aria-label={t("ai.composer.placeholder")}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setMenuOpen(false); }}
          onChange={(e) => { setText(e.target.value); setRecall(null); }}
          onKeyDown={(e) => {
            if (commands.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % commands.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + commands.length) % commands.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(commands[active]); return; }
              if (e.key === "Escape") { e.preventDefault(); setMenuOpen(false); if (slashQuery !== undefined) setText(""); return; }
            }
            // Recall earlier messages like a terminal: ArrowUp/ArrowDown on an empty or recalled box.
            if ((e.key === "ArrowUp" || e.key === "ArrowDown") && sent.length > 0 && (text === "" || recall !== null) && !e.shiftKey) {
              e.preventDefault();
              const next = e.key === "ArrowUp" ? (recall === null ? sent.length - 1 : Math.max(recall - 1, 0)) : recall === null ? null : recall + 1 >= sent.length ? null : recall + 1;
              setRecall(next);
              setText(next === null ? "" : sent[next] ?? "");
              return;
            }
            if (e.key === "Escape" && busy) { e.preventDefault(); onStop(); return; }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          maxLength={4000}
        />

        <div className="ai-capsule__bar">
          <ModeSwitch compact mode={mode} allowed={allowed} disabled={busy} onChange={onMode} />
          <button
            type="button"
            className={`ai-round ai-round--ghost ai-round--slash${menuOpen ? " is-on" : ""}`}
            onMouseDown={(e) => { e.preventDefault(); setMenuOpen((o) => !o); ref.current?.focus(); }}
            aria-label={t("ai.slash.title")}
            title={`${t("ai.slash.title")} (/)`}
          >
            <span aria-hidden="true">/</span>
          </button>
          <button
            type="button"
            className={`ai-round ai-round--ghost${file ? " is-on" : ""}`}
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            disabled={busy}
            aria-label={t("ai.composer.attach")}
            title={t("ai.composer.attach")}
          >
            <i className="pi pi-paperclip" aria-hidden="true" />
          </button>
          <input ref={fileRef} type="file" hidden accept={FILE_TYPES.join(",")} onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="ai-capsule__spacer" />
          {busy && liveLabel ? (
            <span className="ai-capsule__live" aria-live="polite">
              <span className="ai-loader" aria-hidden="true"><i /><i /><i /></span>
              <span>{liveLabel}</span>
            </span>
          ) : null}
          {pctUsed > 0.75 ? (
            <span className={`ai-meter${pctUsed > 0.95 ? " is-full" : ""}`} style={{ "--p": pctUsed } as React.CSSProperties} title={`${text.length}/4000`} aria-label={`${text.length}/4000`} />
          ) : null}
          {canDictate ? (
            <button type="button" className={`ai-round ai-round--ghost${listening ? " is-live" : ""}`} onClick={(e) => { e.stopPropagation(); dictate(); }} aria-label={t("ai.composer.dictate")} title={t("ai.composer.dictate")}>
              <i className={listening ? "pi pi-stop-circle" : "pi pi-microphone"} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={`ai-round ai-round--send${busy ? " is-stop" : ""}${text.trim() || file ? " is-ready" : ""}`}
            onClick={(e) => { e.stopPropagation(); if (busy) onStop(); else submit(); }}
            disabled={!busy && !text.trim() && !file}
            aria-label={busy ? t("ai.composer.stop") : t("ai.composer.send")}
            title={busy ? `${t("ai.composer.stop")} (Esc)` : `${t("ai.composer.send")} (Enter)`}
          >
            <i className={busy ? "pi pi-stop" : "pi pi-arrow-up"} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="ai-composer__hint">
        <span><kbd>Enter</kbd> {t("ai.composer.keySend")}</span>
        <span><kbd>Shift</kbd>+<kbd>Enter</kbd> {t("ai.composer.keyLine")}</span>
        <span><kbd>/</kbd> {t("ai.composer.keyCommands")}</span>
        <span><kbd>↑</kbd> {t("ai.composer.keyRecall")}</span>
        <span><kbd>Ctrl</kbd>+<kbd>J</kbd> {t("ai.composer.keyToggle")}</span>
      </p>
    </div>
  );
}
