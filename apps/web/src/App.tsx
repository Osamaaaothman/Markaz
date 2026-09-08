// M0: empty scaffold only — no real screens yet, so no i18n wiring here either.
// i18next + RTL scaffolding lands in M3 (docs/14-MILESTONES.md); from that point on,
// no user-facing string may be hard-coded (docs/08-FRONTEND-I18N-RULES.md §3).
export function App(): React.JSX.Element {
  return <div data-testid="app-root" />;
}
