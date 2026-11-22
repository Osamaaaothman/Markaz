// The assistant's face: a soft gradient orb. It breathes slowly when idle, swirls while thinking,
// and holds still with a warm ring when changes wait for approval. Pure CSS (ai.css); motion is
// switched off for users who ask for reduced motion.
export function AssistantOrb({ state = "idle", size = 28 }: { state?: "idle" | "thinking" | "waiting"; size?: number }): React.JSX.Element {
  return (
    <span className={`ai-orb ai-orb--${state}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="ai-orb__core" />
      <span className="ai-orb__shine" />
    </span>
  );
}
