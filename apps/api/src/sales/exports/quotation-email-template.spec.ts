import type { QuotationDetail } from "@erp/core";
import { quotationEmailContent } from "./quotation-email-template.js";

const quotation: QuotationDetail = {
  id: "q1", number: "QUO-2026-014", status: "OPEN", customerId: "c1",
  customerName: "Al Majd Group", customerNameAr: "مجموعة المجد", customerEmail: null,
  quotationDate: "2026-11-11", validUntil: "2026-11-25", currency: "SAR",
  totalNet: "9650", totalTax: "1447.5", totalGross: "11097.5", salesOrderId: null, notes: null, lines: [],
};

describe("quotation correspondence", () => {
  it("provides a branded Arabic subject and recipient-ready copy without operator instructions", async () => {
    const email = await quotationEmailContent({ quotation, language: "ar", companyName: "شركة مركز" });
    expect(email.subject).toContain("شركة مركز");
    expect(email.subject).toContain(quotation.number);
    expect(email.text).toContain("السادة/ مجموعة المجد المحترمون");
    expect(email.text).toContain("فريق المبيعات\nشركة مركز");
    expect(email.text).toContain("11,097.50 SAR");
    expect(email.text).not.toMatch(/تم تنزيل|جهازك|Gmail|download|attach it/i);
    expect(email.html).toContain('dir="rtl"');
  });

  it("uses English throughout and handles a quotation without an expiry", async () => {
    const email = await quotationEmailContent({ quotation: { ...quotation, validUntil: null }, language: "en", companyName: "Markaz" });
    expect(email.subject).toBe("Your quotation from Markaz | QUO-2026-014");
    expect(email.text).toContain("Dear Al Majd Group,");
    expect(email.text).toContain("Sales Team\nMarkaz");
    expect(email.text).not.toContain("valid until");
    expect(email.html).not.toMatch(/[\u0600-\u06ff]/);
  });

  it("escapes untrusted names in HTML and keeps the localized expiry readable", async () => {
    const email = await quotationEmailContent({ quotation: { ...quotation, customerName: "<script>bad</script>" }, language: "en", companyName: "A & B" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("25 November 2026");
  });
});
