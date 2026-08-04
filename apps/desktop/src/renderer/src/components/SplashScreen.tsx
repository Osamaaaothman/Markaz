import { useRef } from "react";
import { Box, Text } from "@mantine/core";
import { gsap, useGSAP } from "../lib/gsap";

interface SplashScreenProps {
  onFinish: () => void;
}

// Boot splash shown briefly on every launch. GSAP owns this one sequence
// because its timeline gives precise, choreographed control over a
// multi-step "hero" animation — everyday UI motion elsewhere uses Motion
// instead (see the plan's Animation Strategy section for the split).
// Kept deliberately minimal: scale in, draw the mark, fade the wordmark,
// fade out. No glow/shine/decoration — matches the flat, clean design system.
export function SplashScreen({ onFinish }: SplashScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<SVGRectElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: onFinish,
      });

      tl.addLabel("start")
        .fromTo(
          tileRef.current,
          { scale: 0.7, transformOrigin: "50% 50%" },
          { scale: 1, duration: 0.45, ease: "back.out(1.8)" },
          "start",
        )
        .fromTo(pathRef.current, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.5 }, "-=0.15")
        .fromTo(
          wordmarkRef.current,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.35 },
          "-=0.15",
        )
        .to(containerRef.current, { opacity: 0, duration: 0.35, ease: "power1.in" }, "+=0.4");
    },
    { scope: containerRef },
  );

  return (
    <Box
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--mantine-color-body)",
        zIndex: 1000,
      }}
    >
      <svg width="96" height="96" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5c7ac5" />
            <stop offset="100%" stopColor="#26478a" />
          </linearGradient>
        </defs>
        <rect ref={tileRef} x="4" y="4" width="92" height="92" rx="22" fill="url(#splashGrad)" />
        <path
          ref={pathRef}
          d="M28,72 L28,28 L50,50 L72,28 L72,72"
          fill="none"
          stroke="#ffffff"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div ref={wordmarkRef}>
        <Text fw={700} size="xl" c="brand.8">
          Markaz
        </Text>
      </div>
    </Box>
  );
}
