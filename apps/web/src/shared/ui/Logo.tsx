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

// The Markaz emblem: four corner brackets framing a brass square at the centre — "markaz" means centre.
// Matches the official brand mark (markaz-brand/svg/markaz-mark-*.svg, app-icon-rounded-1024.svg): green
// tile, cream frame, brass centre. Each bracket is drawn with an SVG stroke (pathLength = 1) so the frame
// can be animated as if drawn in, then the centre square pops in and a shine passes.
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
        <rect width="64" height="64" fill="#1C5A40" />
        {/* four corner brackets framing the centre, like the brand's registration-mark "meem" */}
        <g transform="translate(16 16) scale(0.6667)">
          <path className="mk-logo__ring" d="M6 21V6H21" fill="none" stroke="#ECE9E1" strokeWidth="6" strokeLinejoin="miter" strokeLinecap="butt" pathLength="1" />
          <path className="mk-logo__ring" d="M27 6H42V21" fill="none" stroke="#ECE9E1" strokeWidth="6" strokeLinejoin="miter" strokeLinecap="butt" pathLength="1" />
          <path className="mk-logo__ring" d="M42 27V42H27" fill="none" stroke="#ECE9E1" strokeWidth="6" strokeLinejoin="miter" strokeLinecap="butt" pathLength="1" />
          <path className="mk-logo__ring" d="M21 42H6V27" fill="none" stroke="#ECE9E1" strokeWidth="6" strokeLinejoin="miter" strokeLinecap="butt" pathLength="1" />
          {/* the centre */}
          <rect className="mk-logo__dot" x="18" y="18" width="12" height="12" fill="#C9AA5C" />
        </g>
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
