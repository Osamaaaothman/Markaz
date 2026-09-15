import {
  BarChart3,
  BookText,
  LayoutDashboard,
  LineChart,
  Network,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: LucideIcon;
}

// One place to add a nav entry as new modules land (M4+) — docs/08-FRONTEND-I18N-RULES.md
// §1 "one folder per domain area." Every label is a translation key, never literal text.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/accounting/chart-of-accounts", labelKey: "nav.chartOfAccounts", icon: Network },
  { to: "/accounting/trial-balance", labelKey: "nav.trialBalance", icon: BarChart3 },
  { to: "/accounting/balance-sheet", labelKey: "nav.balanceSheet", icon: Wallet },
  { to: "/accounting/income-statement", labelKey: "nav.incomeStatement", icon: LineChart },
  { to: "/accounting/journal-entries", labelKey: "nav.journalEntries", icon: BookText },
  { to: "/settings/users", labelKey: "nav.usersRoles", icon: Users },
];
