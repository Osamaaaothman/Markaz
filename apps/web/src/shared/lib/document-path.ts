// Only real detail routes are linked; unknown document kinds remain plain text.
export function documentPath(kind: string, id: string): string | null {
  const paths: Record<string, string> = {
    purchase_order: "/purchasing/orders/",
    goods_receipt: "/inventory/goods-receipts/",
    goods_return: "/purchasing/returns/",
    supplier_invoice: "/purchasing/invoices/",
    sales_order: "/sales/orders/",
    sales_invoice: "/sales/invoices/",
    stock_issue: "/inventory/stock-issues/",
    stock_count: "/inventory/stock-counts/",
    payment: "/payments/",
    hr_payment: "/hr/payments/",
    payroll_run: "/hr/payroll-runs/",
    fixed_asset_capitalization: "/fixed-assets/",
    fixed_asset_opening: "/fixed-assets/",
    depreciation_run: "/fixed-assets/depreciation-runs/",
    depreciation_run_reversal: "/fixed-assets/depreciation-runs/",
  };
  const dialogs: Record<string, string> = {
    quotation: "/sales/quotations",
    purchase_request: "/purchasing/requests",
    journal_entry: "/accounting/journal-entries",
  };
  return paths[kind]
    ? `${paths[kind]}${encodeURIComponent(id)}`
    : dialogs[kind]
      ? `${dialogs[kind]}?view=${encodeURIComponent(id)}`
      : null;
}
