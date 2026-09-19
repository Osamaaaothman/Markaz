export interface NavItem {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: string;
  // Any one of these permissions is enough to show the entry (and open the page). No list
  // means the page is open to every signed-in user. These mirror the read permission of the
  // API each page calls, so a page is hidden exactly when its data request would be refused.
  readonly permissions?: readonly string[];
}

// One place to add a nav entry as new modules land (M4+) — docs/08-FRONTEND-I18N-RULES.md
// §1 "one folder per domain area." Every label is a translation key, never literal text.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: "pi pi-home" },
  { to: "/accounting/chart-of-accounts", labelKey: "nav.chartOfAccounts", icon: "pi pi-sitemap", permissions: ["account:read"] },
  { to: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "pi pi-chart-bar", permissions: ["trial_balance:read"] },
  { to: "/accounting/balance-sheet", labelKey: "nav.balanceSheet", icon: "pi pi-wallet", permissions: ["balance_sheet:read"] },
  { to: "/accounting/income-statement", labelKey: "nav.incomeStatement", icon: "pi pi-chart-line", permissions: ["income_statement:read"] },
  { to: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: "pi pi-book", permissions: ["journal_entry:read"] },
  { to: "/settings/users", labelKey: "nav.usersRoles", icon: "pi pi-users", permissions: ["user:read", "role:read"] },
];
