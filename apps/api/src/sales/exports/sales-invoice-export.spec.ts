import type { SalesInvoiceDetail } from "@erp/core";
import { salesInvoiceToPdfHtml } from "./sales-invoice-export.js";

const invoice: SalesInvoiceDetail = {
  settlementStatus: "OPEN",
  outstandingAmount: "345.0000",
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
  lines: [{ itemId: null, warehouseId: null, warehouseName: null, warehouseNameAr: null, taxCodeId: "vat15", returnableQuantity: "1.0000", originalLineId: null, id: "l1", description: "Cement", quantity: "3.0000", unitPrice: "100.0000", netAmount: "300.0000", taxRate: "15.0000", taxAmount: "45.0000" }],
};

describe("sales invoice PDF html", () => {
  it("prints the buyer's complete identity and English amount words without inventing absent values", async () => {
    const html = await salesInvoiceToPdfHtml({ invoice: { ...invoice,
      customerVatNumber: "399999999900003", customerCommercialRegistration: "1010999999", customerPhone: "+966555555555",
      customerEmail: "buyer@example.test", customerStreetName: "Buyer street", customerBuildingNumber: "1234",
      customerDistrict: "Central", customerCity: "Riyadh", customerPostalCode: "12345", customerCountryCode: "SA",
    }, language: "en", companyName: "Seller & Co" });
    for (const value of ["399999999900003", "1010999999", "+966555555555", "buyer@example.test", "Buyer street", "1234", "Riyadh", "12345", "SA"]) expect(html).toContain(value);
    expect(html).toContain("Three hundred and forty-five Saudi riyals only");
    expect(html).toContain("Seller &amp; Co");
  });
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
    const text = html.replace(/<\/?bdi\b[^>]*>/g, "");
    expect(text).toContain("VAT No.: 300000000000003");
    expect(text).toContain("CR No.: 1010101010");
    expect(html).toContain("1234 - King St, Olaya, Riyadh, 12345");
    expect(text).toContain("Phone: +966500000000");

    const arHtml = await salesInvoiceToPdfHtml({ invoice, language: "ar", companyName: "Co", sellerVatNumber: "300000000000003", sellerPhone: null });
    expect(arHtml.replace(/<\/?bdi\b[^>]*>/g, "")).toContain("الرقم الضريبي: 300000000000003");
    expect(arHtml).not.toContain("VAT No.");
    expect(arHtml).not.toContain("CR No.");
    expect(arHtml).not.toContain("Phone:");
  });
});
