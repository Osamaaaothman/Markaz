import { useEffect, useState } from "react";

const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 0 -> 1 over `durationMs`, eased out. Returns 1 straight away for people who ask for reduced motion, so
// they never see a figure that is not the real one.
export function useCountUp(trigger: unknown, durationMs = 1000, delayMs = 150): number {
  const [progress, setProgress] = useState(() => (reducedMotion() ? 1 : 0));

  useEffect(() => {
    if (reducedMotion()) {
      setProgress(1);
      return undefined;
    }
    let frame = 0;
    let start: number | null = null;
    setProgress(0);
    const timer = window.setTimeout(() => {
      const tick = (now: number): void => {
        start ??= now;
        const t = Math.min((now - start) / durationMs, 1);
        setProgress(1 - Math.pow(1 - t, 4)); // easeOutQuart
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [trigger, durationMs, delayMs]);

  return progress;
}
