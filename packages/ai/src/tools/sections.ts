// Tools are sent to the model by section, not all at once: every request carries the tools' names,
// descriptions and input schemas, and ~70 of them cost ~10k input tokens per call. The model starts
// with the core tools plus the sections the conversation and the current page need, and loads any
// other section with the load_tools tool when the request calls for it.

export const LOAD_TOOLS = "load_tools";

export const SECTIONS = ["sales", "purchasing", "payments", "inventory", "accounting", "reports", "hr", "assets"] as const;
export type Section = (typeof SECTIONS)[number];

// What each section holds, shown to the model in load_tools' description.
export const SECTION_CONTENTS: Readonly<Record<Section, string>> = {
  sales: "quotations, sales orders, delivery notes, sales invoices, credit/debit notes",
  purchasing: "purchase requests and orders, approvals, goods receipts, supplier invoices (also from an attached document), supplier debit notes",
  payments: "customer receipts, supplier payments, reversals, payment and cash expense lists",
  inventory: "items (edit), warehouses, stock levels and movements, stock issues",
  accounting: "chart of accounts (create), account statements, journal entries and reversals",
  reports: "income statement, balance sheet, cash flow, aging, trial balance, monthly revenue/expenses",
  hr: "employees, salary advances, payroll runs",
  assets: "fixed assets: register, capitalize, depreciation runs",
};

// Always sent: the lookups almost every request needs.
const CORE = new Set(["dashboard_overview", "parties_search", "parties_createCustomer", "parties_createSupplier", "parties_update", "parties_statement", "items_search", "accounts_search", "taxCodes_list", "employees_search"]);

// Tool name prefix → section. Names not listed fall in "core".
const PREFIX: Readonly<Record<string, Section>> = {
  sales: "sales", quotations: "sales", salesOrders: "sales", deliveryNotes: "sales", salesInvoices: "sales",
  purchasing: "purchasing", purchaseOrders: "purchasing", purchaseRequests: "purchasing", supplierInvoices: "purchasing", goodsReceipts: "purchasing",
  payments: "payments", cashExpenses: "payments",
  inventory: "inventory", items: "inventory",
  accounting: "accounting", accounts: "accounting", journalEntries: "accounting",
  reports: "reports",
  hr: "hr", employees: "hr",
  assets: "assets", fixedAssets: "assets",
};

export function sectionOf(toolName: string): Section | "core" {
  if (CORE.has(toolName)) return "core";
  return PREFIX[toolName.split("_")[0] ?? ""] ?? "core";
}

// The section a page belongs to, so its tools are there from the first message on that page.
export function sectionOfRoute(route: string | undefined): Section | null {
  if (!route) return null;
  const first = route.split("/").filter(Boolean)[0] ?? "";
  const byPath: Readonly<Record<string, Section>> = {
    sales: "sales", purchasing: "purchasing", payments: "payments", inventory: "inventory", accounting: "accounting",
    reports: "reports", hr: "hr", assets: "assets", "fixed-assets": "assets",
  };
  return byPath[first] ?? null;
}
