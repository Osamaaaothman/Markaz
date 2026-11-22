// Imported from the Claude Design handoff (docs/Planning/design/assistant-orb); types adapted to the app's TS settings.
// Markaz assistant orb — Direction C · "Precision instrument"
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
        const reach = r.width * 2.5;
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

const CORNERS = [
  { cls: "b1", d: "M16 25V16H25" },
  { cls: "b2", d: "M39 16H48V25" },
  { cls: "b3", d: "M48 39V48H39" },
  { cls: "b4", d: "M25 48H16V39" },
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

  const cls = ["mko-c", `s-${state}`, size <= 30 ? "sm" : "", interactive ? "int" : ""].filter(Boolean).join(" ");
  const style = { "--lvl": state === "listening" ? clamp01(audioLevel) : 0 } as CSSProperties;

  return (
    <svg ref={ref} className={cls} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label ?? state} style={style}>
      <g className="prs">
        <g className="shk">
          <rect className="t t0" width="64" height="64" rx="16" />
          <rect className="t t1" width="64" height="64" rx="16" />
          <rect className="t t2" width="64" height="64" rx="16" />
          <g className="frame">
            <path className="tk" d="M32 11.5V15.5M52.5 32H48.5M32 52.5V48.5M11.5 32H15.5" />
            {CORNERS.map((b) => (
              <g key={b.cls} className={`b ${b.cls}`}>
                <g className="bi">
                  <path className="bk bc" d={b.d} />
                  <path className="bk bb" d={b.d} />
                </g>
              </g>
            ))}
            <path className="scan" d="M21 32H43" />
          </g>
          <g className="core">
            <rect className="ring ring1" x="26" y="26" width="12" height="12" />
            <rect className="ring ring2" x="26" y="26" width="12" height="12" />
            <g className="cpose">
              <rect className="cl c1" x="27.5" y="27.5" width="9" height="9" />
              <rect className="cl c2" x="27.5" y="27.5" width="9" height="9" />
            </g>
            <rect className="bar bar1" x="25" y="25" width="3.6" height="14" />
            <rect className="bar bar2" x="30.2" y="25" width="3.6" height="14" />
            <rect className="bar bar3" x="35.4" y="25" width="3.6" height="14" />
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
