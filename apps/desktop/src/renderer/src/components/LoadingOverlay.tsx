import { Box, Text } from "@mantine/core";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

interface LoadingOverlayProps {
  /** Defaults to the translated generic "Loading…" if omitted — always pass
   * a translation-key-backed message for specific waits (see App.tsx). */
  message?: string;
  /** Fills the viewport when true (default); otherwise fills its parent. */
  fullScreen?: boolean;
}

// Generic, reusable loading state for any indeterminate async wait —
// connecting to the API, sync in progress, etc. Motion (not GSAP) owns
// this: it's tied to component mount/unmount, which is exactly what
// Motion's declarative model is for. See the plan's Animation Strategy.
export function LoadingOverlay({ message, fullScreen = true }: LoadingOverlayProps) {
  const { t } = useTranslation();
  const resolvedMessage = message ?? t("common.loading");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: fullScreen ? "fixed" : "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--mantine-color-body)",
        zIndex: 900,
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [1, 0.85, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Box
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(135deg, #5c7ac5 0%, #26478a 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 100 100">
            <path
              d="M28,72 L28,28 L50,50 L72,28 L72,72"
              fill="none"
              stroke="#ffffff"
              strokeWidth="13"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Box>
      </motion.div>
      <Text c="dimmed" size="sm">
        {resolvedMessage}
      </Text>
    </motion.div>
  );
}
