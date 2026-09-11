import "./shared/i18n/config";
import { useDocumentDirection } from "./shared/i18n/use-document-direction";

// M3: i18next + RTL wiring lands here (docs/14-MILESTONES.md) — real screens land
// in M9. This still renders no visible UI; it only proves the locale/direction
// plumbing every screen after this depends on (docs/08-FRONTEND-I18N-RULES.md §4).
export function App(): React.JSX.Element {
  useDocumentDirection();
  return <div data-testid="app-root" />;
}
