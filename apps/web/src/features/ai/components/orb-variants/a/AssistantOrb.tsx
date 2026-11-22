// Imported from the Claude Design handoff (docs/Planning/design/assistant-orb); types adapted to the app's TS settings.
// Markaz assistant orb — Direction A · "Living emblem"
// React 18 + TypeScript, no animation library. Styles: ./AssistantOrb.css
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import "./AssistantOrb.css";

import type { OrbState } from "../../../orb-state";
export type { OrbState };

export interface AssistantOrbProps {
  state?: OrbState | undefined;
  size?: number | undefined;
  label?: string | undefined;
  audioLevel?: number | undefined;
  interactive?: boolean | undefined;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Pointer tracking for the hero size: writes --px / --py (−3..3 viewBox units) without re-rendering. */
function usePointerLook(ref: RefObject<SVGSVGElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const reach = r.width * 2.5; // full deflection at 2.5× the orb size away
        el.style.setProperty("--px", (Math.max(-1, Math.min(1, dx / reach)) * 3).toFixed(2));
        el.style.setProperty("--py", (Math.max(-1, Math.min(1, dy / reach)) * 3).toFixed(2));
      });
    };
    const reset = (): void => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", reset);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", reset);
      reset();
    };
  }, [ref, enabled]);
}

const BRACKETS = [
  { cls: "b1", d: "M20 30V20H30" },
  { cls: "b2", d: "M34 20H44V30" },
  { cls: "b3", d: "M44 34V44H34" },
  { cls: "b4", d: "M30 44H20V34" },
];

export function AssistantOrb({
  state = "idle",
  size = 34,
  label,
  audioLevel = 0,
  interactive = false,
}: AssistantOrbProps): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  usePointerLook(ref, interactive && size >= 60);

  const cls = ["mko-a", `s-${state}`, size <= 30 ? "sm" : "", interactive ? "int" : ""].filter(Boolean).join(" ");
  const style = { "--lvl": state === "listening" ? clamp01(audioLevel) : 0 } as CSSProperties;

  return (
    <svg ref={ref} className={cls} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label ?? state} style={style}>
      <g className="prs">
        <g className="shk">
          <rect className="t t0" width="64" height="64" rx="16" />
          <rect className="t t1" width="64" height="64" rx="16" />
          <rect className="t t2" width="64" height="64" rx="16" />
          <g className="frame">
            {BRACKETS.map((b) => (
              <g key={b.cls} className={`b ${b.cls}`}>
                <g className="bi">
                  <path className="bk bc" d={b.d} />
                  <path className="bk bb" d={b.d} />
                </g>
              </g>
            ))}
          </g>
          <g className="core">
            <g className="cpose">
              <rect className="ring" x="26" y="26" width="12" height="12" />
              <rect className="cl c1" x="28" y="28" width="8" height="8" />
              <rect className="cl c2" x="28" y="28" width="8" height="8" />
            </g>
            <path className="gl gok" d="M25 32.5l5 5 9.5-10.5" />
            <path className="gl ger" d="M26.5 26.5l11 11M37.5 26.5l-11 11" />
          </g>
          <rect className="edge" x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" />
        </g>
      </g>
    </svg>
  );
}

export default AssistantOrb;
