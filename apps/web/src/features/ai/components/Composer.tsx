import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiStore } from "../ai-store";

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

// The input: grows with the text, Enter sends (Shift+Enter for a new line), the mic dictates into
// the box (never sends by itself — the user reviews first), and Stop cancels a running answer.
export function Composer({ busy, onSend, onStop, suggestions }: { busy: boolean; onSend: (text: string) => void; onStop: () => void; suggestions: string[] }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const prefill = useAiStore((s) => s.prefill);
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const canDictate = recognitionCtor() !== null;

  // Text handed over from elsewhere (e.g. "Ask the assistant about this" buttons) lands in the box for review.
  useEffect(() => {
    if (prefill === null) return;
    setText(useAiStore.getState().takePrefill() ?? "");
    ref.current?.focus();
  }, [prefill]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = (): void => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
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
      {suggestions.length > 0 && !text ? (
        <div className="ai-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ai-chip" disabled={busy} onClick={() => onSend(s)}>
              <i className="pi pi-sparkles" aria-hidden="true" /> {s}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`ai-composer__box${listening ? " ai-composer__box--listening" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={listening ? t("ai.composer.listening") : t("ai.composer.placeholder")}
          aria-label={t("ai.composer.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          maxLength={4000}
        />
        {canDictate ? (
          <button type="button" className={`ai-icon-btn${listening ? " ai-icon-btn--live" : ""}`} onClick={dictate} aria-label={t("ai.composer.dictate")} title={t("ai.composer.dictate")}>
            <i className="pi pi-microphone" aria-hidden="true" />
          </button>
        ) : null}
        {busy ? (
          <button type="button" className="ai-send ai-send--stop" onClick={onStop} aria-label={t("ai.composer.stop")} title={t("ai.composer.stop")}>
            <i className="pi pi-stop" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="ai-send" onClick={submit} disabled={!text.trim()} aria-label={t("ai.composer.send")} title={t("ai.composer.send")}>
            <i className="pi pi-arrow-up" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="ai-composer__hint">{t("ai.composer.hint")}</p>
    </div>
  );
}
