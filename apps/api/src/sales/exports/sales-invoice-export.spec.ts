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
  customerVatNumber: null,
  customerCommercialRegistration: null,
  customerStreetName: null,
  customerAdditionalStreetName: null,
  customerBuildingNumber: null,
  customerAdditionalNumber: null,
  customerDistrict: null,
  customerCity: null,
  customerPostalCode: null,
  lines: [{ id: "l1", description: "Cement", quantity: "3.0000", unitPrice: "100.0000", netAmount: "300.0000", taxRate: "15.0000", taxAmount: "45.0000" }],
};

describe("sales invoice PDF html", () => {
  it("renders RTL Arabic with the Arabic customer name and every total", async () => {
    const html = await salesInvoiceToPdfHtml({ invoice, language: "ar", companyName: "Co" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("العميل");
    expect(html).toContain("345.00 SAR");
    expect(html).toContain("45.00 SAR");
    expect(html).toContain("فقط ثلاثمائة وخمسة وأربعون ريال لا غير");
  });

  it("escapes values, and titles a credit note differently", async () => {
    const html = await salesInvoiceToPdfHtml({ invoice: { ...invoice, documentType: "CREDIT_NOTE" }, language: "en", companyName: "Co" });
    expect(html).toContain("Credit Note");
    expect(html).not.toContain("<Ltd>");
    expect(html).toContain("Customer &lt;Ltd&gt;");
  });

  it("renders seller VAT, CR, address and phone under the company name, omitting empty ones", async () => {
    const html = await salesInvoiceToPdfHtml({
      invoice,
      language: "en",
      companyName: "Co",
      sellerVatNumber: "300000000000003",
      sellerCrNumber: "1010101010",
      sellerAddress: "1234 - King St, Olaya, Riyadh, 12345",
      sellerPhone: "+966500000000",
    });
    expect(html).toContain("VAT No.: 300000000000003");
    expect(html).toContain("CR No.: 1010101010");
    expect(html).toContain("1234 - King St, Olaya, Riyadh, 12345");
    expect(html).toContain("Phone: +966500000000");

    const arHtml = await salesInvoiceToPdfHtml({ invoice, language: "ar", companyName: "Co", sellerVatNumber: "300000000000003", sellerPhone: null });
    expect(arHtml).toContain("الرقم الضريبي: 300000000000003");
    expect(arHtml).not.toContain("VAT No.");
    expect(arHtml).not.toContain("CR No.");
    expect(arHtml).not.toContain("Phone:");
  });
});
