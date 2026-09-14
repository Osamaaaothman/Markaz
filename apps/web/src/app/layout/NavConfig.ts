export interface NavItem {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: string;
}

// One place to add a nav entry as new modules land (M4+) — docs/08-FRONTEND-I18N-RULES.md
// §1 "one folder per domain area." Every label is a translation key, never literal text.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: "pi pi-home" },
  { to: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "pi pi-chart-bar" },
  { to: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: "pi pi-book" },
];
