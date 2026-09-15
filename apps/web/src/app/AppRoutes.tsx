import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ChartOfAccountsPage } from "../features/accounting/ChartOfAccountsPage";
import { TrialBalancePage } from "../features/accounting/TrialBalancePage";
import { BalanceSheetPage } from "../features/accounting/BalanceSheetPage";
import { IncomeStatementPage } from "../features/accounting/IncomeStatementPage";
import { JournalEntriesPage } from "../features/accounting/JournalEntriesPage";
import { UsersPage } from "../features/settings/UsersPage";
import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./ProtectedRoute";

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/accounting/chart-of-accounts" element={<ChartOfAccountsPage />} />
          <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
          <Route path="/accounting/balance-sheet" element={<BalanceSheetPage />} />
          <Route path="/accounting/income-statement" element={<IncomeStatementPage />} />
          <Route path="/accounting/journal-entries" element={<JournalEntriesPage />} />
          <Route path="/settings/users" element={<UsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
