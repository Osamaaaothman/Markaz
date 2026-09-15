export interface NavItem {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: string;
}

// One place to add a nav entry as new modules land (M4+) — docs/08-FRONTEND-I18N-RULES.md
// §1 "one folder per domain area." Every label is a translation key, never literal text.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: "pi pi-home" },
  { to: "/accounting/chart-of-accounts", labelKey: "nav.chartOfAccounts", icon: "pi pi-sitemap" },
  { to: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "pi pi-chart-bar" },
  { to: "/accounting/balance-sheet", labelKey: "nav.balanceSheet", icon: "pi pi-wallet" },
  { to: "/accounting/income-statement", labelKey: "nav.incomeStatement", icon: "pi pi-chart-line" },
  { to: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: "pi pi-book" },
  { to: "/settings/users", labelKey: "nav.usersRoles", icon: "pi pi-users" },
];
