import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { DesignSystemPage } from "../features/design-system/DesignSystemPage";
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
import { StockMovementsPage } from "../features/inventory/StockMovementsPage";
import { WarehousesPage } from "../features/inventory/WarehousesPage";
import { ApprovalPolicyPage } from "../features/purchasing/ApprovalPolicyPage";
import { SupplierInvoiceFormPage } from "../features/purchasing/SupplierInvoiceFormPage";
import { SupplierInvoicesPage } from "../features/purchasing/SupplierInvoicesPage";
import { TaxCodesPage } from "../features/purchasing/TaxCodesPage";
import { PurchaseOrderDetailPage } from "../features/purchasing/PurchaseOrderDetailPage";
import { PurchaseOrderFormPage } from "../features/purchasing/PurchaseOrderFormPage";
import { PurchaseOrdersPage } from "../features/purchasing/PurchaseOrdersPage";
import { PurchaseRequestsPage } from "../features/purchasing/PurchaseRequestsPage";
import { QuotationsPage } from "../features/sales/QuotationsPage";
import { QuotationFormPage, SalesInvoiceFormPage, SalesOrderFormPage } from "../features/sales/SalesDocumentFormPage";
import { SalesInvoiceDetailPage, SalesInvoicesPage } from "../features/sales/SalesInvoicesPage";
import { SalesOrderDetailPage, SalesOrdersPage } from "../features/sales/SalesOrdersPage";
import { CustomerReceiptPage, SupplierPaymentPage } from "../features/payments/PaymentFormPage";
import { PaymentsPage } from "../features/payments/PaymentsPage";
import { AgingPage } from "../features/payments/AgingPage";
import { PartyStatementPage } from "../features/payments/PartyStatementPage";
import { UsersPage } from "../features/settings/UsersPage";
import { AppShell } from "./layout/AppShell";
import { NAV_ITEMS } from "./layout/NavConfig";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequirePermission } from "./RequirePermission";
import { DocumentsPage } from "../features/attachments/DocumentsPage";

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
          <Route path="/design-system" element={<DesignSystemPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/movements")} />}>
            <Route path="/inventory/movements" element={<StockMovementsPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/invoices")} />}>
            <Route path="/purchasing/invoices" element={<SupplierInvoicesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["supplier_invoice:create"]} />}>
            <Route path="/purchasing/invoices/new" element={<SupplierInvoiceFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/documents")} />}>
            <Route path="/documents" element={<DocumentsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/tax-codes")} />}>
            <Route path="/settings/tax-codes" element={<TaxCodesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/sales/quotations")} />}>
            <Route path="/sales/quotations" element={<QuotationsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["quotation:create"]} />}>
            <Route path="/sales/quotations/new" element={<QuotationFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/sales/orders")} />}>
            <Route path="/sales/orders" element={<SalesOrdersPage />} />
            <Route path="/sales/orders/:id" element={<SalesOrderDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["sales_order:create"]} />}>
            <Route path="/sales/orders/new" element={<SalesOrderFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/sales/invoices")} />}>
            <Route path="/sales/invoices" element={<SalesInvoicesPage />} />
            <Route path="/sales/invoices/:id" element={<SalesInvoiceDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["sales_invoice:create"]} />}>
            <Route path="/sales/invoices/new" element={<SalesInvoiceFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/payments")} />}>
            <Route path="/payments" element={<PaymentsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["customer_receipt:create"]} />}>
            <Route path="/payments/receipts/new" element={<CustomerReceiptPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["supplier_payment:create"]} />}>
            <Route path="/payments/supplier/new" element={<SupplierPaymentPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/aging")} />}>
            <Route path="/accounting/aging" element={<AgingPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/party-statement")} />}>
            <Route path="/accounting/party-statement" element={<PartyStatementPage />} />
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
