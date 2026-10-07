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
  { to: "/accounting/aging", labelKey: "nav.aging", icon: "pi pi-clock", permissions: ["aging_report:read"], groupKey: "nav.groups.accounting" },
  { to: "/accounting/party-statement", labelKey: "nav.partyStatement", icon: "pi pi-id-card", permissions: ["party_statement:read"], groupKey: "nav.groups.accounting" },
  { to: "/parties", labelKey: "nav.parties", icon: "pi pi-address-book", permissions: ["party:read"], groupKey: "nav.groups.masterData" },
  { to: "/inventory/warehouses", labelKey: "nav.warehouses", icon: "pi pi-building", permissions: ["warehouse:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/items", labelKey: "nav.items", icon: "pi pi-box", permissions: ["item:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-levels", labelKey: "nav.stockLevels", icon: "pi pi-chart-bar", permissions: ["stock:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/movements", labelKey: "nav.stockMovements", icon: "pi pi-history", permissions: ["stock:read"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/goods-receipts/new", labelKey: "nav.goodsReceipt", icon: "pi pi-download", permissions: ["goods_receipt:create"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-issues/new", labelKey: "nav.stockIssue", icon: "pi pi-upload", permissions: ["stock_issue:create"], groupKey: "nav.groups.inventory" },
  { to: "/inventory/stock-counts", labelKey: "nav.stockCount", icon: "pi pi-check-square", permissions: ["stock_count:read"], groupKey: "nav.groups.inventory" },
  { to: "/purchasing/requests", labelKey: "nav.purchaseRequests", icon: "pi pi-inbox", permissions: ["purchase_request:read"], groupKey: "nav.groups.purchasing" },
  { to: "/purchasing/orders", labelKey: "nav.purchaseOrders", icon: "pi pi-shopping-cart", permissions: ["purchase_order:read"], groupKey: "nav.groups.purchasing" },
  { to: "/purchasing/invoices", labelKey: "nav.supplierInvoices", icon: "pi pi-receipt", permissions: ["supplier_invoice:read"], groupKey: "nav.groups.purchasing" },
  { to: "/sales/quotations", labelKey: "nav.quotations", icon: "pi pi-file-edit", permissions: ["quotation:read"], groupKey: "nav.groups.sales" },
  { to: "/sales/orders", labelKey: "nav.salesOrders", icon: "pi pi-shopping-bag", permissions: ["sales_order:read"], groupKey: "nav.groups.sales" },
  { to: "/sales/invoices", labelKey: "nav.salesInvoices", icon: "pi pi-file", permissions: ["sales_invoice:read"], groupKey: "nav.groups.sales" },
  { to: "/payments", labelKey: "nav.payments", icon: "pi pi-wallet", permissions: ["payment:read"], groupKey: "nav.groups.payments" },
  { to: "/documents", labelKey: "nav.documents", icon: "pi pi-paperclip", permissions: ["attachment:read"], groupKey: "nav.groups.documents" },
  { to: "/settings/users", labelKey: "nav.usersRoles", icon: "pi pi-users", permissions: ["user:read", "role:read"], groupKey: "nav.groups.settings" },
  { to: "/settings/account-mapping", labelKey: "nav.accountMapping", icon: "pi pi-link", permissions: ["account_mapping:read"], groupKey: "nav.groups.settings" },
  { to: "/settings/tax-codes", labelKey: "nav.taxCodes", icon: "pi pi-percentage", permissions: ["tax_code:read"], groupKey: "nav.groups.settings" },
  { to: "/settings/approvals", labelKey: "nav.approvalLimits", icon: "pi pi-verified", permissions: ["approval_policy:read"], groupKey: "nav.groups.settings" },
];
