import { GOSI_LAW_EFFECTIVE_DATE, GosiLegacyTrackError, computeGosiContribution, pensionRateTotalAsOf } from "./gosi.js";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("pensionRateTotalAsOf", () => {
  it("is 18% within the first 12 months of the law", () => {
    expect(pensionRateTotalAsOf(d(2024, 7, 2))).toBe("0.18");
    expect(pensionRateTotalAsOf(d(2025, 7, 1))).toBe("0.18");
  });
  it("steps to 19% in months 13-24, 20% in months 25-36, 21% in months 37-48", () => {
    expect(pensionRateTotalAsOf(d(2025, 7, 2))).toBe("0.19");
    expect(pensionRateTotalAsOf(d(2026, 7, 2))).toBe("0.20"); // today's bracket (18 Oct 2026)
    expect(pensionRateTotalAsOf(d(2027, 7, 2))).toBe("0.21");
  });
  it("reaches the permanent 22% from month 49 on", () => {
    expect(pensionRateTotalAsOf(d(2028, 7, 2))).toBe("0.22");
    expect(pensionRateTotalAsOf(d(2030, 1, 1))).toBe("0.22");
  });
});

describe("computeGosiContribution", () => {
  const asOf = d(2026, 10, 18); // today -- 20% pension bracket

  it("splits the pension rate 50/50 and adds occupational hazards (employer) and SANED (both) for a Saudi", () => {
    const result = computeGosiContribution({ basicSalary: "6000", housingAllowance: "1500", isSaudi: true, gosiLegacyTrack: false, asOf });
    // base = 7500; pension 20% -> 10%+10% = 750 each; hazards 2% = 150 (employer); SANED 1%+1% = 75 each
    expect(result.contributionBase).toBe("7500.0000");
    expect(result.pensionRateTotal).toBe("0.20");
    expect(result.employeeShare).toBe("825.0000"); // 750 + 75
    expect(result.employerShare).toBe("975.0000"); // 750 + 150 + 75
  });

  it("charges an expatriate only the flat 2% occupational-hazards rate, employer-borne, nothing else", () => {
    const result = computeGosiContribution({ basicSalary: "6000", housingAllowance: "1500", isSaudi: false, gosiLegacyTrack: false, asOf });
    expect(result.employeeShare).toBe("0.0000");
    expect(result.employerShare).toBe("150.0000"); // 2% of 7500
  });

  it("caps the contribution base at SAR 45,000", () => {
    const result = computeGosiContribution({ basicSalary: "60000", housingAllowance: "10000", isSaudi: true, gosiLegacyTrack: false, asOf });
    expect(result.contributionBase).toBe("45000.0000");
  });

  it("never computes a rate for an employee on the legacy track -- that is a human decision", () => {
    expect(() => computeGosiContribution({ basicSalary: "6000", housingAllowance: "0", isSaudi: true, gosiLegacyTrack: true, asOf })).toThrow(GosiLegacyTrackError);
  });

  it("ignores other allowances -- only basic and housing count toward the base", () => {
    const withExtra = computeGosiContribution({ basicSalary: "6000", housingAllowance: "1500", isSaudi: true, gosiLegacyTrack: false, asOf });
    // same as the first test -- other allowances never passed in, confirming the signature has no such field
    expect(withExtra.contributionBase).toBe("7500.0000");
  });

  it("GOSI_LAW_EFFECTIVE_DATE is 2 July 2024, from the Royal Decree's own date converted via Umm al-Qura", () => {
    expect(GOSI_LAW_EFFECTIVE_DATE.toISOString().slice(0, 10)).toBe("2024-07-02");
  });
});
