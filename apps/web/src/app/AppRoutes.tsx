import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ChartOfAccountsPage } from "../features/accounting/ChartOfAccountsPage";
import { AccountStatementPage } from "../features/accounting/AccountStatementPage";
import { TrialBalancePage } from "../features/accounting/TrialBalancePage";
import { BalanceSheetPage } from "../features/accounting/BalanceSheetPage";
import { IncomeStatementPage } from "../features/accounting/IncomeStatementPage";
import { JournalEntriesPage } from "../features/accounting/JournalEntriesPage";
import { PartiesPage } from "../features/parties/PartiesPage";
import { AccountMappingPage } from "../features/inventory/AccountMappingPage";
import { GoodsReceiptPage } from "../features/inventory/GoodsReceiptPage";
import { ItemsPage } from "../features/inventory/ItemsPage";
import { StockCountPage } from "../features/inventory/StockCountPage";
import { StockIssuePage } from "../features/inventory/StockIssuePage";
import { StockLevelsPage } from "../features/inventory/StockLevelsPage";
import { WarehousesPage } from "../features/inventory/WarehousesPage";
import { ApprovalPolicyPage } from "../features/purchasing/ApprovalPolicyPage";
import { PurchaseOrderDetailPage } from "../features/purchasing/PurchaseOrderDetailPage";
import { PurchaseOrderFormPage } from "../features/purchasing/PurchaseOrderFormPage";
import { PurchaseOrdersPage } from "../features/purchasing/PurchaseOrdersPage";
import { PurchaseRequestsPage } from "../features/purchasing/PurchaseRequestsPage";
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
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/account-statement")} />}>
            <Route path="/accounting/account-statement" element={<AccountStatementPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/warehouses")} />}>
            <Route path="/inventory/warehouses" element={<WarehousesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/items")} />}>
            <Route path="/inventory/items" element={<ItemsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/stock-levels")} />}>
            <Route path="/inventory/stock-levels" element={<StockLevelsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/goods-receipts/new")} />}>
            <Route path="/inventory/goods-receipts/new" element={<GoodsReceiptPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/stock-issues/new")} />}>
            <Route path="/inventory/stock-issues/new" element={<StockIssuePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/stock-counts")} />}>
            <Route path="/inventory/stock-counts" element={<StockCountPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/requests")} />}>
            <Route path="/purchasing/requests" element={<PurchaseRequestsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/orders")} />}>
            <Route path="/purchasing/orders" element={<PurchaseOrdersPage />} />
            <Route path="/purchasing/orders/:id" element={<PurchaseOrderDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["purchase_order:create"]} />}>
            <Route path="/purchasing/orders/new" element={<PurchaseOrderFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/approvals")} />}>
            <Route path="/settings/approvals" element={<ApprovalPolicyPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/account-mapping")} />}>
            <Route path="/settings/account-mapping" element={<AccountMappingPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
