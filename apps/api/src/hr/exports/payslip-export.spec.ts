import type { PayrollRunLine } from "@erp/core";
import { payslipToPdfHtml } from "./payslip-export.js";

const line: PayrollRunLine = {
  employeeId: "e1",
  employeeRef: "EMP-000001",
  employeeName: "Sara Ahmed",
  employeeNameAr: "سارة أحمد",
  nationalId: "1234567890",
  bankIban: "SA0380000000608010167519",
  basicSalary: "6000.0000",
  housingAllowance: "1500.0000",
  otherAllowances: "0.0000",
  gross: "7500.0000",
  gosiEmployeeShare: "825.0000",
  gosiEmployerShare: "975.0000",
  advanceDeduction: "400.0000",
  net: "6275.0000",
};

const base = {
  runNumber: "PYR-FY2026-000001",
  periodYear: 2026,
  periodMonth: 10,
  runDate: "2026-10-31",
  currency: "SAR",
  line,
  companyName: "Markaz Co",
};

describe("payslip PDF html", () => {
  it("renders RTL Arabic with the Arabic employee name and the right period and net pay", async () => {
    const html = await payslipToPdfHtml({ ...base, language: "ar" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("سارة أحمد");
    expect(html).toContain("أكتوبر 2026");
    expect(html).toContain("6275.00 SAR");
  });

  it("renders LTR English with every earning and deduction line", async () => {
    const html = await payslipToPdfHtml({ ...base, language: "en" });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Sara Ahmed");
    expect(html).toContain("October 2026");
    expect(html).toContain("6000.00 SAR"); // basic
    expect(html).toContain("1500.00 SAR"); // housing
    expect(html).toContain("825.00 SAR"); // GOSI
    expect(html).toContain("400.00 SAR"); // advance
    expect(html).toContain("7500.00 SAR"); // gross
    expect(html).toContain("6275.00 SAR"); // net
  });

  it("falls back to the English name when no Arabic name is on file", async () => {
    const html = await payslipToPdfHtml({ ...base, language: "ar", line: { ...line, employeeNameAr: null } });
    expect(html).toContain("Sara Ahmed");
  });
});
