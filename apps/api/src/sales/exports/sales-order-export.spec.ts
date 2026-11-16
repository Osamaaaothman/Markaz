import type { SalesOrderDetail } from "@erp/core";
import { salesOrderToPdfHtml } from "./sales-order-export.js";

const order: SalesOrderDetail = {
  id: "o1",
  number: "SO-FY2026-000001",
  status: "OPEN",
  customerId: "c1",
  customerName: "Customer <Ltd> & Co",
  customerNameAr: "العميل",
  orderDate: "2026-03-20",
  currency: "SAR",
  totalNet: "300.0000",
  totalTax: "45.0000",
  totalGross: "345.0000",
  notes: null,
  lines: [{ id: "l1", itemId: null, description: "Cement", quantity: "3.0000", unitPrice: "100.0000", taxCodeId: "vat15", taxRate: "15.0000", netAmount: "300.0000", taxAmount: "45.0000" }],
};

describe("sales order PDF html", () => {
  it("prints the customer name, every total and the English document title, escaping the customer name", async () => {
    const html = await salesOrderToPdfHtml({ order, language: "en", companyName: "Seller & Co" });
    expect(html).toContain("Customer &lt;Ltd&gt; &amp; Co");
    expect(html).not.toContain("<Ltd>");
    expect(html).toContain("300.00 SAR");
    expect(html).toContain("45.00 SAR");
    expect(html).toContain("345.00 SAR");
    expect(html).toContain("Sales Order SO-FY2026-000001");
    expect(html).toContain("Seller &amp; Co");
  });

  it("renders RTL Arabic with the Arabic customer name", async () => {
    const html = await salesOrderToPdfHtml({ order, language: "ar", companyName: "Co" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("العميل");
    expect(html).toContain("أمر بيع");
    expect(html).toContain("345.00 SAR");
  });
});
