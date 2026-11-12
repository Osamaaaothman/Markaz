import { lazy, Suspense } from "react";
import { PageSkeleton } from "../shared/ui/PageSkeleton";
import { Navigate, Route, Routes } from "react-router-dom";
const DraftsPage = lazy(() => import("../features/documents/DraftsPage").then((module) => ({ default: module.DraftsPage })));
const LoginPage = lazy(() => import("../features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DesignSystemPage = lazy(() => import("../features/design-system/DesignSystemPage").then((module) => ({ default: module.DesignSystemPage })));
const ChartOfAccountsPage = lazy(() => import("../features/accounting/ChartOfAccountsPage").then((module) => ({ default: module.ChartOfAccountsPage })));
const AccountStatementPage = lazy(() => import("../features/accounting/AccountStatementPage").then((module) => ({ default: module.AccountStatementPage })));
const TrialBalancePage = lazy(() => import("../features/accounting/TrialBalancePage").then((module) => ({ default: module.TrialBalancePage })));
const BalanceSheetPage = lazy(() => import("../features/accounting/BalanceSheetPage").then((module) => ({ default: module.BalanceSheetPage })));
const IncomeStatementPage = lazy(() => import("../features/accounting/IncomeStatementPage").then((module) => ({ default: module.IncomeStatementPage })));
const CashFlowPage = lazy(() => import("../features/accounting/CashFlowPage").then((module) => ({ default: module.CashFlowPage })));
const JournalEntriesPage = lazy(() => import("../features/accounting/JournalEntriesPage").then((module) => ({ default: module.JournalEntriesPage })));
const PartiesPage = lazy(() => import("../features/parties/PartiesPage").then((module) => ({ default: module.PartiesPage })));
const SetupPage = lazy(() => import("../features/setup/SetupPage").then((module) => ({ default: module.SetupPage })));
const AuditLogPage = lazy(() => import("../features/audit/AuditLogPage").then((module) => ({ default: module.AuditLogPage })));
const AccountMappingPage = lazy(() => import("../features/inventory/AccountMappingPage").then((module) => ({ default: module.AccountMappingPage })));
const GoodsReceiptDetailPage = lazy(() => import("../features/inventory/GoodsReceiptDetailPage").then((module) => ({ default: module.GoodsReceiptDetailPage })));
const GoodsReceiptsPage = lazy(() => import("../features/inventory/GoodsReceiptsPage").then((module) => ({ default: module.GoodsReceiptsPage })));
const StockIssueDetailPage = lazy(() => import("../features/inventory/StockIssueDetailPage").then((module) => ({ default: module.StockIssueDetailPage })));
const StockIssuesPage = lazy(() => import("../features/inventory/StockIssuesPage").then((module) => ({ default: module.StockIssuesPage })));
const GoodsReceiptPage = lazy(() => import("../features/inventory/GoodsReceiptPage").then((module) => ({ default: module.GoodsReceiptPage })));
const ItemsPage = lazy(() => import("../features/inventory/ItemsPage").then((module) => ({ default: module.ItemsPage })));
const StockCountDetailPage = lazy(() => import("../features/inventory/StockCountDetailPage").then((module) => ({ default: module.StockCountDetailPage })));
const StockCountPage = lazy(() => import("../features/inventory/StockCountPage").then((module) => ({ default: module.StockCountPage })));
const StockIssuePage = lazy(() => import("../features/inventory/StockIssuePage").then((module) => ({ default: module.StockIssuePage })));
const StockLevelsPage = lazy(() => import("../features/inventory/StockLevelsPage").then((module) => ({ default: module.StockLevelsPage })));
const StockMovementsPage = lazy(() => import("../features/inventory/StockMovementsPage").then((module) => ({ default: module.StockMovementsPage })));
const WarehousesPage = lazy(() => import("../features/inventory/WarehousesPage").then((module) => ({ default: module.WarehousesPage })));
const ApprovalPolicyPage = lazy(() => import("../features/purchasing/ApprovalPolicyPage").then((module) => ({ default: module.ApprovalPolicyPage })));
const CompliancePage = lazy(() => import("../features/compliance/CompliancePage").then((module) => ({ default: module.CompliancePage })));
const SupplierInvoiceFormPage = lazy(() => import("../features/purchasing/SupplierInvoiceFormPage").then((module) => ({ default: module.SupplierInvoiceFormPage })));
const SupplierInvoicesPage = lazy(() => import("../features/purchasing/SupplierInvoicesPage").then((module) => ({ default: module.SupplierInvoicesPage })));
const TaxCodesPage = lazy(() => import("../features/purchasing/TaxCodesPage").then((module) => ({ default: module.TaxCodesPage })));
const GoodsReturnDetailPage = lazy(() => import("../features/purchasing/GoodsReturnDetailPage").then((module) => ({ default: module.GoodsReturnDetailPage })));
const GoodsReturnsPage = lazy(() => import("../features/purchasing/GoodsReturnsPage").then((module) => ({ default: module.GoodsReturnsPage })));
const SupplierInvoiceDetailPage = lazy(() => import("../features/purchasing/SupplierInvoiceDetailPage").then((module) => ({ default: module.SupplierInvoiceDetailPage })));
const PurchaseOrderDetailPage = lazy(() => import("../features/purchasing/PurchaseOrderDetailPage").then((module) => ({ default: module.PurchaseOrderDetailPage })));
const PurchaseOrderFormPage = lazy(() => import("../features/purchasing/PurchaseOrderFormPage").then((module) => ({ default: module.PurchaseOrderFormPage })));
const PurchaseOrdersPage = lazy(() => import("../features/purchasing/PurchaseOrdersPage").then((module) => ({ default: module.PurchaseOrdersPage })));
const PurchaseRequestReviewPage = lazy(() => import("../features/purchasing/PurchaseRequestReviewPage").then((module) => ({ default: module.PurchaseRequestReviewPage })));
const PurchaseRequestsPage = lazy(() => import("../features/purchasing/PurchaseRequestsPage").then((module) => ({ default: module.PurchaseRequestsPage })));
const HrPaymentDetailPage = lazy(() => import("../features/hr/HrPaymentDetailPage").then((module) => ({ default: module.HrPaymentDetailPage })));
const HrPaymentsPage = lazy(() => import("../features/hr/HrPaymentsPage").then((module) => ({ default: module.HrPaymentsPage })));
const AllowanceTypesPage = lazy(() => import("../features/hr/AllowanceTypesPage").then((module) => ({ default: module.AllowanceTypesPage })));
const EmployeeDetailPage = lazy(() => import("../features/hr/EmployeeDetailPage").then((module) => ({ default: module.EmployeeDetailPage })));
const EmployeesPage = lazy(() => import("../features/hr/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const PayrollRunDetailPage = lazy(() => import("../features/hr/PayrollRunDetailPage").then((module) => ({ default: module.PayrollRunDetailPage })));
const PayrollRunsPage = lazy(() => import("../features/hr/PayrollRunsPage").then((module) => ({ default: module.PayrollRunsPage })));
const QuotationsPage = lazy(() => import("../features/sales/QuotationsPage").then((module) => ({ default: module.QuotationsPage })));
const QuotationFormPage = lazy(() => import("../features/sales/SalesDocumentFormPage").then((module) => ({ default: module.QuotationFormPage })));
const SalesInvoiceFormPage = lazy(() => import("../features/sales/SalesDocumentFormPage").then((module) => ({ default: module.SalesInvoiceFormPage })));
const SalesOrderFormPage = lazy(() => import("../features/sales/SalesDocumentFormPage").then((module) => ({ default: module.SalesOrderFormPage })));
const SalesInvoiceDetailPage = lazy(() => import("../features/sales/SalesInvoicesPage").then((module) => ({ default: module.SalesInvoiceDetailPage })));
const SalesInvoicesPage = lazy(() => import("../features/sales/SalesInvoicesPage").then((module) => ({ default: module.SalesInvoicesPage })));
const SalesOrderDetailPage = lazy(() => import("../features/sales/SalesOrdersPage").then((module) => ({ default: module.SalesOrderDetailPage })));
const SalesOrdersPage = lazy(() => import("../features/sales/SalesOrdersPage").then((module) => ({ default: module.SalesOrdersPage })));
const CustomerReceiptPage = lazy(() => import("../features/payments/PaymentFormPage").then((module) => ({ default: module.CustomerReceiptPage })));
const SupplierPaymentPage = lazy(() => import("../features/payments/PaymentFormPage").then((module) => ({ default: module.SupplierPaymentPage })));
const PaymentDetailPage = lazy(() => import("../features/payments/PaymentDetailPage").then((module) => ({ default: module.PaymentDetailPage })));
const ReceiptsPage = lazy(() => import("../features/payments/PaymentsPage").then((module) => ({ default: module.ReceiptsPage })));
const SupplierPaymentsPage = lazy(() => import("../features/payments/PaymentsPage").then((module) => ({ default: module.SupplierPaymentsPage })));
const SettleReceiptsPage = lazy(() => import("../features/payments/SettlePage").then((module) => ({ default: module.SettleReceiptsPage })));
const SettleSupplierPage = lazy(() => import("../features/payments/SettlePage").then((module) => ({ default: module.SettleSupplierPage })));
const CashExpensesPage = lazy(() => import("../features/payments/CashExpensesPage").then((module) => ({ default: module.CashExpensesPage })));
const CashExpenseFormPage = lazy(() => import("../features/payments/CashExpenseFormPage").then((module) => ({ default: module.CashExpenseFormPage })));
const AgingPage = lazy(() => import("../features/payments/AgingPage").then((module) => ({ default: module.AgingPage })));
const PartyStatementPage = lazy(() => import("../features/payments/PartyStatementPage").then((module) => ({ default: module.PartyStatementPage })));
const UsersPage = lazy(() => import("../features/settings/UsersPage").then((module) => ({ default: module.UsersPage })));
import { AppShell } from "./layout/AppShell";
import { NAV_ITEMS } from "./layout/NavConfig";
import { ProtectedRoute } from "./ProtectedRoute";
import { RequirePermission } from "./RequirePermission";
const DocumentsPage = lazy(() => import("../features/attachments/DocumentsPage").then((module) => ({ default: module.DocumentsPage })));
const CompanyPage = lazy(() => import("../features/settings/CompanyPage").then((module) => ({ default: module.CompanyPage })));
const InterfaceSettingsPage = lazy(() => import("../features/settings/InterfaceSettingsPage").then((module) => ({ default: module.InterfaceSettingsPage })));

// The permissions a route needs come from NAV_ITEMS, so hiding a nav entry and guarding its
// page can never disagree.
function permissionsFor(path: string): readonly string[] {
  return NAV_ITEMS.find((item) => item.to === path)?.permissions ?? [];
}

export function AppRoutes(): React.JSX.Element {
  return (
    <Suspense fallback={<PageSkeleton />}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="/documents/drafts" element={<DraftsPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/accounting/cash-flow")} />}>
            <Route path="/accounting/cash-flow" element={<CashFlowPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/goods-receipts")} />}>
            <Route path="/inventory/goods-receipts" element={<GoodsReceiptsPage />} />
            <Route path="/inventory/goods-receipts/:id" element={<GoodsReceiptDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["goods_receipt:create"]} />}>
            <Route path="/inventory/goods-receipts/new" element={<GoodsReceiptPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/stock-issues")} />}>
            <Route path="/inventory/stock-issues" element={<StockIssuesPage />} />
            <Route path="/inventory/stock-issues/:id" element={<StockIssueDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["stock_issue:create"]} />}>
            <Route path="/inventory/stock-issues/new" element={<StockIssuePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/inventory/stock-counts")} />}>
            <Route path="/inventory/stock-counts" element={<StockCountPage />} />
            <Route path="/inventory/stock-counts/:id" element={<StockCountDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/hr/employees")} />}>
            <Route path="/hr/employees" element={<EmployeesPage />} />
            <Route path="/hr/employees/:id" element={<EmployeeDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/setup")} />}>
            <Route path="/setup" element={<SetupPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/hr/payments")} />}>
            <Route path="/hr/payments" element={<HrPaymentsPage />} />
            <Route path="/hr/payments/:id" element={<HrPaymentDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/hr/allowance-types")} />}>
            <Route path="/hr/allowance-types" element={<AllowanceTypesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/hr/payroll-runs")} />}>
            <Route path="/hr/payroll-runs" element={<PayrollRunsPage />} />
            <Route path="/hr/payroll-runs/:id" element={<PayrollRunDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/requests")} />}>
            <Route path="/purchasing/requests" element={<PurchaseRequestsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/review")} />}>
            <Route path="/purchasing/review" element={<PurchaseRequestReviewPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/orders")} />}>
            <Route path="/purchasing/orders" element={<PurchaseOrdersPage />} />
            <Route path="/purchasing/orders/:id" element={<PurchaseOrderDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["purchase_order:create"]} />}>
            <Route path="/purchasing/orders/new" element={<PurchaseOrderFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/returns")} />}>
            <Route path="/purchasing/returns" element={<GoodsReturnsPage />} />
            <Route path="/purchasing/returns/:id" element={<GoodsReturnDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/purchasing/invoices")} />}>
            <Route path="/purchasing/invoices" element={<SupplierInvoicesPage />} />
            <Route path="/purchasing/invoices/:id" element={<SupplierInvoiceDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["supplier_invoice:create"]} />}>
            <Route path="/purchasing/invoices/new" element={<SupplierInvoiceFormPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/company")} />}>
            <Route path="/settings/company" element={<CompanyPage />} />
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
            <Route path="/payments/receipts" element={<ReceiptsPage />} />
            <Route path="/payments/supplier" element={<SupplierPaymentsPage />} />
            <Route path="/payments/:id" element={<PaymentDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["customer_receipt:create"]} />}>
            <Route path="/payments/receipts/new" element={<CustomerReceiptPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["supplier_payment:create"]} />}>
            <Route path="/payments/supplier/new" element={<SupplierPaymentPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["payment:create"]} />}>
            <Route path="/payments/receipts/settle" element={<SettleReceiptsPage />} />
            <Route path="/payments/supplier/settle" element={<SettleSupplierPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["cash_expense:read"]} />}>
            <Route path="/payments/cash-expenses" element={<CashExpensesPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["cash_expense:create"]} />}>
            <Route path="/payments/cash-expenses/new" element={<CashExpenseFormPage />} />
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
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/zatca")} />}>
            <Route path="/settings/zatca" element={<CompliancePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/account-mapping")} />}>
            <Route path="/settings/account-mapping" element={<AccountMappingPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={permissionsFor("/settings/audit-log")} />}>
            <Route path="/settings/audit-log" element={<AuditLogPage />} />
          </Route>
          <Route path="/settings/interface" element={<InterfaceSettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}
