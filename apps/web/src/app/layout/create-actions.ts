export interface CreateAction {
  readonly id: string;
  readonly labelKey: string;
  readonly to: string;
  readonly icon: string;
  // The permission the page behind it needs; the action is offered only to a user who holds it.
  readonly permission: string;
  // Which part of the app it belongs to — picks its colour on the dashboard.
  readonly group: "sales" | "purchasing" | "inventory" | "payments" | "accounting";
}

// Things people create every day, each gated by the same permission the page behind it needs. One list for
// the command palette and the dashboard, so a new document type is added in one place.
export const CREATE_ACTIONS: readonly CreateAction[] = [
  { id: "new-sales-invoice", labelKey: "dashboard.actions.invoice", to: "/sales/invoices/new", icon: "pi pi-receipt", permission: "sales_invoice:create", group: "sales" },
  { id: "new-receipt", labelKey: "dashboard.actions.receipt", to: "/payments/receipts/new", icon: "pi pi-arrow-down-left", permission: "customer_receipt:create", group: "payments" },
  { id: "new-supplier-payment", labelKey: "payments.newPayment", to: "/payments/supplier/new", icon: "pi pi-arrow-up-right", permission: "supplier_payment:create", group: "payments" },
  { id: "new-quotation", labelKey: "sales.quotations.new", to: "/sales/quotations/new", icon: "pi pi-file-edit", permission: "quotation:create", group: "sales" },
  { id: "new-sales-order", labelKey: "sales.orders.new", to: "/sales/orders/new", icon: "pi pi-shopping-bag", permission: "sales_order:create", group: "sales" },
  { id: "new-po", labelKey: "dashboard.actions.purchaseOrder", to: "/purchasing/orders/new", icon: "pi pi-shopping-cart", permission: "purchase_order:create", group: "purchasing" },
  { id: "new-supplier-invoice", labelKey: "dashboard.actions.supplierInvoice", to: "/purchasing/invoices/new", icon: "pi pi-file", permission: "supplier_invoice:create", group: "purchasing" },
  { id: "new-goods-receipt", labelKey: "nav.goodsReceipt", to: "/inventory/goods-receipts/new", icon: "pi pi-download", permission: "goods_receipt:create", group: "inventory" },
];
