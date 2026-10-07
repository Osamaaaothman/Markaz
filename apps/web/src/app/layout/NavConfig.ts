export interface NavItem {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: string;
  // Any one of these permissions is enough to show the entry (and open the page). No list
  // means the page is open to every signed-in user. These mirror the read permission of the
  // API each page calls, so a page is hidden exactly when its data request would be refused.
  readonly permissions?: readonly string[];
  // Section heading it sits under in the sidebar (a translation key under `nav.groups`); no group = top of the list.
  readonly groupKey?: string;
}

// One place to add a nav entry as new modules land (M4+) — docs/08-FRONTEND-I18N-RULES.md
// §1 "one folder per domain area." Every label is a translation key, never literal text.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: "pi pi-home" },
  { to: "/accounting/chart-of-accounts", labelKey: "nav.chartOfAccounts", icon: "pi pi-sitemap", permissions: ["account:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: "pi pi-book", permissions: ["journal_entry:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/account-statement", labelKey: "nav.accountStatement", icon: "pi pi-list", permissions: ["journal_entry:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: "pi pi-chart-bar", permissions: ["trial_balance:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/balance-sheet", labelKey: "nav.balanceSheet", icon: "pi pi-wallet", permissions: ["balance_sheet:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/income-statement", labelKey: "nav.incomeStatement", icon: "pi pi-chart-line", permissions: ["income_statement:read"], groupKey: "nav.groups.accounting" },
  { to: "/parties", labelKey: "nav.parties", icon: "pi pi-address-book", permissions: ["party:read"], groupKey: "nav.groups.masterData" },
  { to: "/inventory/warehouses", labelKey: "nav.warehouses", icon: "pi pi-building", permissions: ["warehouse:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/items", labelKey: "nav.items", icon: "pi pi-box", permissions: ["item:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-levels", labelKey: "nav.stockLevels", icon: "pi pi-chart-bar", permissions: ["stock:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/goods-receipts/new", labelKey: "nav.goodsReceipt", icon: "pi pi-download", permissions: ["goods_receipt:create"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-issues/new", labelKey: "nav.stockIssue", icon: "pi pi-upload", permissions: ["stock_issue:create"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-counts", labelKey: "nav.stockCount", icon: "pi pi-check-square", permissions: ["stock_count:read"], groupKey: "nav.groups.inventory" },
  { to: "/settings/users", labelKey: "nav.usersRoles", icon: "pi pi-users", permissions: ["user:read", "role:read"], groupKey: "nav.groups.settings" },
  { to: "/settings/account-mapping", labelKey: "nav.accountMapping", icon: "pi pi-link", permissions: ["account_mapping:read"], groupKey: "nav.groups.settings" },
];
