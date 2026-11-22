import { useTranslation } from "react-i18next";
import type { AssistantMode } from "../ai-api";

const MODES: ReadonlyArray<{ mode: AssistantMode; icon: string }> = [
  { mode: "ask", icon: "pi pi-comments" },
  { mode: "review", icon: "pi pi-check-square" },
  { mode: "auto", icon: "pi pi-bolt" },
];

// Three modes on one track with a sliding, colour-changing thumb (ask = calm, review = blue, auto = amber).
export function ModeSwitch({ mode, allowed, disabled, onChange, compact }: { mode: AssistantMode; allowed: Record<AssistantMode, boolean>; disabled: boolean; onChange: (m: AssistantMode) => void; compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const index = MODES.findIndex((m) => m.mode === mode);
  return (
    <div className={`ai-switch ai-switch--${mode}${compact ? " ai-switch--compact" : ""}`} role="radiogroup" aria-label={t("ai.mode.label")} style={{ "--i": index } as React.CSSProperties}>
      <span className="ai-switch__thumb" aria-hidden="true" />
      {MODES.map(({ mode: m, icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          disabled={!allowed[m] || disabled}
          className={`ai-switch__opt${mode === m ? " is-active" : ""}`}
          onClick={() => onChange(m)}
          title={allowed[m] ? t(`ai.mode.${m}Hint`) : t("ai.mode.notAllowed")}
        >
          <i className={icon} aria-hidden="true" />
          <span>{t(`ai.mode.${m}`)}</span>
        </button>
      ))}
    </div>
  );
}
