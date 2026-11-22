import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ORB_STYLES, useAiStore } from "../ai-store";
import type { OrbState } from "../orb-state";
import { AssistantOrb } from "./AssistantOrb";
import "../ai.css";

const STATES: readonly OrbState[] = ["idle", "thinking", "speaking", "listening", "waiting", "success", "error"];
// The two journeys a user sees most, played with real timings so the transitions can be judged.
const SEQUENCES: Readonly<Record<"approve" | "fail", ReadonlyArray<readonly [OrbState, number]>>> = {
  approve: [["idle", 900], ["thinking", 2200], ["speaking", 1800], ["waiting", 2200], ["success", 1600], ["idle", 0]],
  fail: [["idle", 900], ["thinking", 2000], ["error", 1600], ["idle", 0]],
};

// Settings → Interface: choose the assistant's face. All three designs are shown live, side by side,
// in the same state; buttons switch the state, play a sequence, and simulate a voice for "listening".
export function OrbStylePicker(): React.JSX.Element {
  const { t } = useTranslation();
  const style = useAiStore((s) => s.orbStyle);
  const setStyle = useAiStore((s) => s.setOrbStyle);
  const [state, setState] = useState<OrbState>("thinking");
  const timers = useRef<number[]>([]);

  const clear = (): void => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clear, []);

  // Fake microphone level so "listening" can be previewed without dictating.
  useEffect(() => {
    if (state !== "listening") return undefined;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      useAiStore.getState().setAudioLevel(Math.abs(Math.sin(tick / 3)) * 0.8 + Math.random() * 0.2);
    }, 100);
    return () => { window.clearInterval(id); useAiStore.getState().setAudioLevel(0); };
  }, [state]);

  const play = (name: keyof typeof SEQUENCES): void => {
    clear();
    let at = 0;
    for (const [s, ms] of SEQUENCES[name]) {
      timers.current.push(window.setTimeout(() => setState(s), at));
      at += ms;
    }
  };

  return (
    <section className="erp-card ai-orb-picker">
      <h2 className="erp-card__title">{t("ai.orbPicker.title")}</h2>
      <p className="erp-card__empty" style={{ textAlign: "start" }}>{t("ai.orbPicker.hint")}</p>

      <div className="ai-orb-picker__grid" role="radiogroup" aria-label={t("ai.orbPicker.title")}>
        {ORB_STYLES.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={style === v} className={`ai-orb-picker__card${style === v ? " is-active" : ""}`} onClick={() => setStyle(v)}>
            <span className="ai-orb-picker__stage">
              <AssistantOrb variant={v} state={state} size={96} interactive label={t(`ai.orb.${state}`)} />
            </span>
            <span className="ai-orb-picker__sizes" aria-hidden="true">
              <AssistantOrb variant={v} state={state} size={34} />
              <AssistantOrb variant={v} state={state} size={22} />
            </span>
            <strong>{t(`ai.orbPicker.styles.${v}.name`)}</strong>
            <small>{t(`ai.orbPicker.styles.${v}.idea`)}</small>
          </button>
        ))}
      </div>

      <div className="ai-orb-picker__controls">
        <div className="ai-orb-picker__states" role="group" aria-label={t("ai.orbPicker.states")}>
          {STATES.map((s) => (
            <button key={s} type="button" className={`ai-suggestion${state === s ? " is-on" : ""}`} onClick={() => { clear(); setState(s); }}>
              {t(`ai.orbPicker.state.${s}`)}
            </button>
          ))}
        </div>
        <div className="ai-orb-picker__states">
          <button type="button" className="ai-btn ai-btn--ghost" onClick={() => play("approve")}><i className="pi pi-play" aria-hidden="true" /> {t("ai.orbPicker.playApprove")}</button>
          <button type="button" className="ai-btn ai-btn--ghost" onClick={() => play("fail")}><i className="pi pi-play" aria-hidden="true" /> {t("ai.orbPicker.playFail")}</button>
        </div>
      </div>
    </section>
  );
}
