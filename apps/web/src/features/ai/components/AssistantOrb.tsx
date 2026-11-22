import type { OrbState } from "../orb-state";

// The assistant's face: a glass sphere with aurora light moving inside it. Every state has its own
// colour and motion (ai.css → "Orb"):
//   idle       slow aurora drift, gentle breathing
//   listening  rose light, sound-wave ripples spreading out
//   thinking   fast swirl, three sparks orbiting the sphere
//   speaking   bright core pulsing like a voice, soft waves
//   waiting    amber light with a slow dashed ring — something needs your approval
//   success    green flash with a check and one burst ring
//   error      red flash with a short shake
// Pure CSS, sized in em so one font-size scales every layer; motion stops for reduced-motion users.
export function AssistantOrb({ state = "idle", size = 28, label }: { state?: OrbState; size?: number; label?: string }): React.JSX.Element {
  return (
    <span className={`ai-orb ai-orb--${state}`} style={{ fontSize: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="ai-orb__halo" />
      <span className="ai-orb__wave ai-orb__wave--1" />
      <span className="ai-orb__wave ai-orb__wave--2" />
      <span className="ai-orb__ring" />
      <span className="ai-orb__sphere">
        <span className="ai-orb__blob ai-orb__blob--1" />
        <span className="ai-orb__blob ai-orb__blob--2" />
        <span className="ai-orb__blob ai-orb__blob--3" />
        <span className="ai-orb__core" />
        <span className="ai-orb__gloss" />
      </span>
      <span className="ai-orb__orbit">
        <i /><i /><i />
      </span>
      <span className="ai-orb__glyph">
        <svg viewBox="0 0 24 24" className="ai-orb__check"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
        <svg viewBox="0 0 24 24" className="ai-orb__bang"><path d="M12 6v8" /><path d="M12 18h.01" /></svg>
      </span>
    </span>
  );
}
