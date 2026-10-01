import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ChartOfAccountsPage } from "../features/accounting/ChartOfAccountsPage";
import { TrialBalancePage } from "../features/accounting/TrialBalancePage";
import { BalanceSheetPage } from "../features/accounting/BalanceSheetPage";
import { IncomeStatementPage } from "../features/accounting/IncomeStatementPage";
import { JournalEntriesPage } from "../features/accounting/JournalEntriesPage";
import { PartiesPage } from "../features/parties/PartiesPage";
import { UsersPage } from "../features/settings/UsersPage";
import { AppShell } from "./layout/AppShell";
import { NAV_ITEMS } from "./layout/NavConfig";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequirePermission } from "./RequirePermission";

// The permissions a route needs come from NAV_ITEMS, so hiding a nav entry and guarding its
// page can never disagree.
function permissionsFor(path: string): readonly string[] {
  return NAV_ITEMS.find((item) => item.to === path)?.permissions ?? [];
}

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/chart-of-accounts")} />}>
            <Route path="/accounting/chart-of-accounts" element={<ChartOfAccountsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/parties")} />}>
            <Route path="/parties" element={<PartiesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/trial-balance")} />}>
            <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/balance-sheet")} />}>
            <Route path="/accounting/balance-sheet" element={<BalanceSheetPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/income-statement")} />}>
            <Route path="/accounting/income-statement" element={<IncomeStatementPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/journal-entries")} />}>
            <Route path="/accounting/journal-entries" element={<JournalEntriesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/users")} />}>
            <Route path="/settings/users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
