import type { SalesInvoiceDetail } from "@erp/core";
import { salesInvoiceToPdfHtml } from "./sales-invoice-export.js";

const invoice: SalesInvoiceDetail = {
  id: "i1",
  documentType: "INVOICE",
  number: "INV-FY2026-000001",
  customerId: "c1",
  customerName: "Customer <Ltd>",
  customerNameAr: "العميل",
  originalInvoiceId: null,
  invoiceDate: "2026-03-20",
  dueDate: "2026-04-19",
  currency: "SAR",
  totalNet: "300.0000",
  totalTax: "45.0000",
  totalGross: "345.0000",
  notes: null,
  lines: [{ id: "l1", description: "Cement", quantity: "3.0000", unitPrice: "100.0000", netAmount: "300.0000", taxRate: "15.0000", taxAmount: "45.0000" }],
};

describe("sales invoice PDF html", () => {
  it("renders RTL Arabic with the Arabic customer name and every total", async () => {
    const html = await salesInvoiceToPdfHtml({ invoice, language: "ar", companyName: "Co" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("العميل");
    expect(html).toContain("345.00 SAR");
    expect(html).toContain("45.00 SAR");
  });

  it("escapes values, and titles a credit note differently", async () => {
    const html = await salesInvoiceToPdfHtml({ invoice: { ...invoice, documentType: "CREDIT_NOTE" }, language: "en", companyName: "Co" });
    expect(html).toContain("Credit Note");
    expect(html).not.toContain("<Ltd>");
    expect(html).toContain("Customer &lt;Ltd&gt;");
  });
});
