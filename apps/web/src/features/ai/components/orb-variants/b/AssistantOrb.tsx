// Imported from the Claude Design handoff (docs/Planning/design/assistant-orb); types adapted to the app's TS settings.
// Markaz assistant orb — Direction B · "Dot matrix"
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

/* ── 7×7 grid, 40 dots + brass centre. Only the 20 bracket dots ("a") are lit at rest. ──
   pe = perimeter (24, used by the thinking chase), a = bracket arm, m = mid-edge, cn = corner,
   in = inner dots, k = part of the check glyph, x = part of the cross glyph. */
type Dot = { key: string; cls: string; x: number; y: number; vars: CSSProperties };

const DOTS: Dot[] = (() => {
  const per: [number, number][] = [];
  for (let c = 0; c < 7; c++) per.push([0, c]);
  for (let r = 1; r < 7; r++) per.push([r, 6]);
  for (let c = 5; c >= 0; c--) per.push([6, c]);
  for (let r = 5; r >= 1; r--) per.push([r, 0]);
  const pIndex = (r: number, c: number) => per.findIndex(([a, b]) => a === r && b === c);
  const K = new Set(["3,1", "4,2", "5,3", "4,4", "3,5", "2,6"]);
  const X = new Set(["1,1", "2,2", "4,4", "5,5", "1,5", "2,4", "4,2", "5,1"]);
  const CORNERS = new Set(["0,0", "0,6", "6,0", "6,6"]);
  const out: Dot[] = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (r === 3 && c === 3) continue; // centre is drawn separately
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      const plus = d === 2 && (r === 3 || c === 3);
      const diag = d === 2 && Math.abs(r - 3) === 2 && Math.abs(c - 3) === 2;
      if (!(d === 3 || d === 1 || plus || diag)) continue;
      const key = `${r},${c}`;
      const cls = ["d"];
      if (d === 3) {
        cls.push("pe", r === 3 || c === 3 ? "m" : "a");
        if (CORNERS.has(key)) cls.push("cn");
      } else cls.push("in");
      if (K.has(key)) cls.push("k");
      if (X.has(key)) cls.push("x");
      out.push({
        key,
        cls: cls.join(" "),
        x: 14 + c * 6 - 1.8,
        y: 14 + r * 6 - 1.8,
        vars: {
          "--p": d === 3 ? pIndex(r, c) : 0,
          "--pr": d === 3 ? pIndex(r, 6 - c) : 0, // mirrored index for RTL
          "--col": c,
          "--colr": 6 - c,
          "--row": r,
          "--d": d,
          "--sx": Math.sign(c - 3),
          "--sy": Math.sign(r - 3),
        } as CSSProperties,
      });
    }
  }
  return out;
})();

export function AssistantOrb({
  state = "idle",
  size = 34,
  label,
  audioLevel = 0,
  interactive = false,
}: AssistantOrbProps): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  usePointerLook(ref, interactive && size >= 60);

  const cls = ["mko-b", `s-${state}`, size <= 30 ? "sm" : "", interactive ? "int" : ""].filter(Boolean).join(" ");
  const style = { "--lvl": state === "listening" ? clamp01(audioLevel) : 0 } as CSSProperties;

  return (
    <svg ref={ref} className={cls} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label ?? state} style={style}>
      <g className="prs">
        <g className="shk">
          <rect className="t t0" width="64" height="64" rx="16" />
          <rect className="t t1" width="64" height="64" rx="16" />
          <rect className="t t2" width="64" height="64" rx="16" />
          <g className="frame">
            {DOTS.map((d) => (
              <rect key={d.key} className={d.cls} x={d.x} y={d.y} width="3.6" height="3.6" rx="0.9" style={d.vars} />
            ))}
          </g>
          <g className="core">
            <g className="cpose">
              <rect className="cc c1" x="28.5" y="28.5" width="7" height="7" rx="1.2" />
              <rect className="cc c2" x="28.5" y="28.5" width="7" height="7" rx="1.2" />
            </g>
          </g>
          <rect className="edge" x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" />
        </g>
      </g>
    </svg>
  );
}

export default AssistantOrb;
