import { Prisma } from "@erp/db";
import { invoiceSettlementStatus } from "./invoice-settlement.js";

describe("Invoice settlement presentation", () => {
  const gross = new Prisma.Decimal("100.0000");
  const status = (balance: string, due: string | null = null) =>
    invoiceSettlementStatus("INVOICE", gross, new Prisma.Decimal(balance), due, "2026-11-15");
  it("distinguishes open, partly settled and fully settled at decimal precision", () => {
    expect(status("100.0000")).toBe("OPEN");
    expect(status("99.9999")).toBe("PARTIAL");
    expect(status("0.0001")).toBe("PARTIAL");
    expect(status("0.0000")).toBe("SETTLED");
    expect(status("-10")).toBe("SETTLED");
    expect(status("110")).toBe("OPEN");
  });
  it("marks only an outstanding invoice past its due date overdue", () => {
    expect(status("10", "2026-11-14")).toBe("OVERDUE");
    expect(status("0", "2026-11-14")).toBe("SETTLED");
    expect(status("100", "2026-11-15")).toBe("OPEN");
    expect(status("100", "2026-11-16")).toBe("OPEN");
  });
  it("does not pretend that a credit/debit note is an unpaid invoice", () => {
    for (const kind of ["CREDIT_NOTE", "DEBIT_NOTE"])
      expect(invoiceSettlementStatus(kind, gross, null, null, "2026-11-15")).toBe("RECORDED");
  });
});
