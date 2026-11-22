import { useAiStore, type OrbStyle } from "../ai-store";
import type { OrbState } from "../orb-state";
import { AssistantOrb as LivingEmblem } from "./orb-variants/a/AssistantOrb";
import { AssistantOrb as DotMatrix } from "./orb-variants/b/AssistantOrb";
import { AssistantOrb as PrecisionInstrument } from "./orb-variants/c/AssistantOrb";

// The assistant's face. Three designs from the Claude Design handoff share one API; the user picks one
// in Settings → Interface (or a caller forces one with `variant`, e.g. the preview cards). Every call
// site stays the same. While dictating, the microphone level drives the "listening" state.
const VARIANTS = { a: LivingEmblem, b: DotMatrix, c: PrecisionInstrument } as const;

export interface AssistantOrbProps {
  readonly state?: OrbState | undefined;
  readonly size?: number | undefined;
  readonly label?: string | undefined;
  readonly interactive?: boolean | undefined;
  readonly variant?: OrbStyle | undefined;
}

export function AssistantOrb({ state = "idle", size = 28, label, interactive, variant }: AssistantOrbProps): React.JSX.Element {
  const chosen = useAiStore((s) => s.orbStyle);
  const audioLevel = useAiStore((s) => (state === "listening" ? s.audioLevel : 0));
  const Variant = VARIANTS[variant ?? chosen] ?? LivingEmblem;
  return <Variant state={state} size={size} label={label} audioLevel={audioLevel} interactive={interactive} />;
}
