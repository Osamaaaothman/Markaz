import { usePermissions } from "../../shared/auth/use-permissions";
import { useAiMe } from "./ai-api";

// Whether the assistant's entry points (top-bar button, menu, Ctrl+J, command palette) are shown:
// the user may use it and an admin has not switched it off for the company. While the answer loads
// nothing is shown, so a switched-off assistant never flashes into view.
export function useAssistantVisible(): boolean {
  const perms = usePermissions();
  const allowed = perms.can("ai_assistant:use");
  const me = useAiMe(allowed);
  return allowed && me.data?.visible === true;
}
