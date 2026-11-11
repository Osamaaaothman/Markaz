import { WpsFileError, buildWpsWagesFile } from "./wps-file.js";

const company = { bankSarieId: "RJHISARI", bankAccountNumber: "123456789012", molEstablishmentId: "1-0001234" };
const valueDate = new Date(Date.UTC(2026, 9, 18));

describe("buildWpsWagesFile", () => {
  it("uses exact decimal rounding and sums the amounts actually written to the file", () => {
    const employee = { iban: "SA01", name: "A", nationalId: "1", basicSalary: "1.0050", housingAllowance: "0.0050", otherEarnings: "0", deductions: "0" };
    const rows = buildWpsWagesFile({ company, valueDate, fileReference: "ROUND", employees: [employee, employee] }).split("\r\n").map((row) => row.split("\t"));
    expect(rows[0]![4]).toBe("2,04");
    expect(rows[1]![0]).toBe("1,02");
    expect(rows[1]!.slice(3, 5)).toEqual(["1,01", "0,01"]);
  });
  it("refuses demo company details and embedded file delimiters", () => {
    const employee = { iban: "SA01", name: "A", nationalId: "1", basicSalary: "1", housingAllowance: "0", otherEarnings: "0", deductions: "0" };
    expect(() => buildWpsWagesFile({ company: { ...company, bankAccountNumber: "DEMO123" }, valueDate, fileReference: "X", employees: [employee] })).toThrow(WpsFileError);
    expect(() => buildWpsWagesFile({ company, valueDate, fileReference: "X", employees: [{ ...employee, name: "A\tB" }] })).toThrow(WpsFileError);
  });
  it("writes a TAB-separated header line, one content line per employee, and a closing '-' line", () => {
    const file = buildWpsWagesFile({
      company,
      valueDate,
      fileReference: "PYR-2026-10-0001",
      employees: [
        { iban: "sa0380000000608010167519", name: "Sara Ahmed", nationalId: "1234567890", basicSalary: "6000.00", housingAllowance: "1500.00", otherEarnings: "0.00", deductions: "825.00" },
      ],
    });
    const lines = file.split("\r\n");
    expect(lines).toHaveLength(3); // header + 1 employee + closing marker
    expect(lines[0]).toBe(["RJHISARI", "123456789012", "SAR", "20261018", "6675,00", "PYR-2026-10-0001", "1-0001234"].join("\t"));
    expect(lines[1]).toBe(["6675,00", "SA0380000000608010167519", "Sara Ahmed", "6000,00", "1500,00", "0,00", "825,00", "1234567890"].join("\t"));
    expect(lines[2]).toBe("-");
  });

  it("the header total equals the sum of every employee's net amount", () => {
    const file = buildWpsWagesFile({
      company,
      valueDate,
      fileReference: "PYR-2026-10-0002",
      employees: [
        { iban: "SA01", name: "A", nationalId: "1", basicSalary: "1000.00", housingAllowance: "0.00", otherEarnings: "0.00", deductions: "0.00" },
        { iban: "SA02", name: "B", nationalId: "2", basicSalary: "2000.00", housingAllowance: "500.00", otherEarnings: "100.00", deductions: "50.00" },
      ],
    });
    const [header] = file.split("\r\n");
    expect(header!.split("\t")[4]).toBe("3550,00"); // 1000 + (2000+500+100-50)
  });

  it("refuses an empty roster", () => {
    expect(() => buildWpsWagesFile({ company, valueDate, fileReference: "X", employees: [] })).toThrow(WpsFileError);
  });

  it("uses a comma as the decimal point, per the spec's format conventions", () => {
    const file = buildWpsWagesFile({
      company,
      valueDate,
      fileReference: "PYR-2026-10-0003",
      employees: [{ iban: "SA01", name: "A", nationalId: "1", basicSalary: "1234.56", housingAllowance: "0.00", otherEarnings: "0.00", deductions: "0.00" }],
    });
    expect(file).toContain("1234,56");
    expect(file).not.toContain("1234.56");
  });
});
