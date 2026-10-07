import { useId } from "react";

export interface LogoProps {
  // "mark" is the square emblem alone; "full" adds the wordmark beside it; "stacked" puts it beneath.
  readonly variant?: "mark" | "full" | "stacked";
  readonly size?: number;
  // Plays the draw-in animation once on mount; "loop" keeps a gentle pulse (loading screens).
  readonly animate?: boolean | "loop";
  readonly name: string;
  readonly tagline?: string;
  readonly className?: string;
}

// The Markaz emblem: an open ring with a brass dot at its centre — "markaz" means centre. Ink tile, green
// stroke, brass centre. Drawn with an SVG stroke (pathLength = 1) so the ring can be animated as if drawn in,
// then the dot drops into the middle and a shine passes.
// The emblem itself never mirrors in right-to-left (a logo is not text direction).
export function LogoMark({ size = 40, animate = false, className = "" }: Pick<LogoProps, "size" | "animate" | "className">): React.JSX.Element {
  const uid = useId().replace(/:/g, "");
  const motion = animate === "loop" ? "mk-logo--loop" : animate ? "mk-logo--intro" : "";
  return (
    <svg
      className={`mk-logo ${motion} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
      direction="ltr"
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width="64" height="64" rx="16" />
        </clipPath>
        <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect width="64" height="64" fill="#1b1a17" />
        {/* an open ring: closed all round except a gap on the right, like the opening of the letter meem */}
        <path className="mk-logo__ring" d="M45.24 39.04 A15 15 0 1 1 45.24 24.96" fill="none" stroke="#7fc4a3" strokeWidth="6.4" strokeLinecap="round" pathLength="1" />
        {/* the centre */}
        <circle className="mk-logo__dot" cx="32" cy="32" r="4.8" fill="#c9aa5c" />
        <rect className="mk-logo__shine" x="-40" y="-10" width="30" height="90" fill={`url(#${uid}-shine)`} transform="skewX(-18)" />
      </g>
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ variant = "full", size = 40, animate = false, name, tagline, className = "" }: LogoProps): React.JSX.Element {
  if (variant === "mark") return <LogoMark size={size} animate={animate} className={className} />;
  return (
    <span className={`mk-brand mk-brand--${variant} ${className}`.trim()}>
      <LogoMark size={size} animate={animate} />
      <span className="mk-brand__text">
        <span className="mk-brand__name">{name}</span>
        {tagline ? <span className="mk-brand__tagline">{tagline}</span> : null}
      </span>
    </span>
  );
}
