import type { OrbState } from "../orb-state";

// The assistant's face: the Markaz emblem redrawn as a 5×5 dot matrix — four corner brackets (cream)
// framing a brass centre on the brand-green tile. Each state is a dot pattern, not a different picture
// (ai.css → "Dot matrix"):
//   idle       the emblem; the brass centre breathes
//   thinking   a light runs around the frame, the way the logo draws itself in
//   speaking   columns rise and fall like a voice
//   listening  ripples spread out from the centre
//   waiting    the brackets turn brass and blink slowly — your approval is needed
//   success    the dots form a check on a green tile
//   error      the dots form a cross on a red tile, with a short shake
// Flat brand colours only; sized in em so one font-size scales the whole tile.

const SIZE = 5;
const CENTER = 2;

// Clockwise order of the 16 frame dots, starting top-left — used for the "running light".
const RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 4], [2, 4], [3, 4], [4, 4],
  [4, 3], [4, 2], [4, 1], [4, 0],
  [3, 0], [2, 0], [1, 0],
];
const BRACKETS = new Set(["0,0", "0,1", "1,0", "0,3", "0,4", "1,4", "3,4", "4,4", "4,3", "3,0", "4,0", "4,1"]);
const CHECK = new Set(["2,0", "3,1", "2,2", "1,3", "0,4"]);
const CROSS = new Set(["0,0", "1,1", "2,2", "3,3", "4,4", "0,4", "1,3", "3,1", "4,0"]);

interface Dot { readonly key: string; readonly r: number; readonly c: number; readonly ring: number; readonly d: number; readonly cls: string }

const DOTS: readonly Dot[] = Array.from({ length: SIZE * SIZE }, (_, i) => {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const key = `${r},${c}`;
  const ring = RING.findIndex(([rr, cc]) => rr === r && cc === c);
  const d = Math.round(Math.hypot(r - CENTER, c - CENTER) * 100) / 100;
  const cls = [
    "ai-px",
    BRACKETS.has(key) ? "is-bracket" : "",
    r === CENTER && c === CENTER ? "is-center" : "",
    CHECK.has(key) ? "is-check" : "",
    CROSS.has(key) ? "is-cross" : "",
    ring >= 0 ? "is-ring" : "is-inner",
  ].filter(Boolean).join(" ");
  return { key, r, c, ring, d, cls };
});

export function AssistantOrb({ state = "idle", size = 28, label }: { state?: OrbState; size?: number; label?: string }): React.JSX.Element {
  return (
    <span
      className={`ai-orb ai-orb--${state}`}
      style={{ fontSize: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dir="ltr"
    >
      <span className="ai-orb__grid">
        {DOTS.map((dot) => (
          <i
            key={dot.key}
            className={dot.cls}
            style={{ "--r": dot.r, "--c": dot.c, "--ring": Math.max(dot.ring, 0), "--d": dot.d } as React.CSSProperties}
          />
        ))}
      </span>
    </span>
  );
}
