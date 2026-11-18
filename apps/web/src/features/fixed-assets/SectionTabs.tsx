import "./fixed-assets.css";

export interface SectionTab<T extends string> {
  readonly id: T;
  readonly label: string;
}

// A plain, accessible tab bar. Only the active panel is rendered by the caller, so content always sits directly under
// the bar in both directions and at every width (PrimeReact's TabView misplaced panels on phones in this layout).
export function SectionTabs<T extends string>({ tabs, active, onChange, label }: { readonly tabs: readonly SectionTab<T>[]; readonly active: T; readonly onChange: (id: T) => void; readonly label: string }): React.JSX.Element {
  return (
    <div className="fa-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`fa-tabs__tab${tab.id === active ? " fa-tabs__tab--active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
