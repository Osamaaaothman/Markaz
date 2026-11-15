import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useCountUp } from "../lib/use-count-up";

// True once the surrounding <Reveal> has scrolled into view; true everywhere outside one, so anything that
// reads it behaves exactly as before when it is not wrapped.
const RevealContext = createContext(true);

export function useRevealed(): boolean {
  return useContext(RevealContext);
}

// A card whose animations wait until it is actually on screen. A chart below the fold would otherwise play
// its whole entrance before anyone scrolls to it. Until then every animation inside is paused at its first
// frame (see `.mk-reveal` in pages.css); with no IntersectionObserver it simply plays at once.
export function Reveal({ className, children }: { readonly className?: string; readonly children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <RevealContext.Provider value={seen}>
      <section ref={ref} className={`${className ?? ""} mk-reveal${seen ? " is-in" : ""}`.trim()}>
        {children}
      </section>
    </RevealContext.Provider>
  );
}

// A whole number that counts up from zero once its card is revealed.
export function CountUp({ value, delayMs = 250 }: { readonly value: number; readonly delayMs?: number }): React.JSX.Element {
  const revealed = useRevealed();
  const progress = useCountUp(revealed ? value : -1, 1100, delayMs);
  return <>{Math.round(value * (revealed ? progress : 0))}</>;
}
