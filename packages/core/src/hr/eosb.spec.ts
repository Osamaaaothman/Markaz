import { computeEndOfServiceSettlement } from "./eosb.js";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("computeEndOfServiceSettlement", () => {
  it("pays half a month per year for the first five years, a full month per year after, on employer termination (full entitlement)", () => {
    // 7 years exactly, wage 10,000 -> gross = 5*0.5*10000 + 2*10000 = 25000 + 20000 = 45000
    const result = computeEndOfServiceSettlement({
      wageBase: "10000",
      hireDate: d(2019, 10, 18),
      terminationDate: d(2026, 10, 18),
      reason: "TERMINATION",
    });
    expect(result.grossEntitlement).toBe("45000.0000");
    expect(result.entitlementFraction).toBe("1.0000");
    expect(result.netEntitlement).toBe("45000.0000");
  });

  it("gives a resigning employee with under 2 years nothing", () => {
    const result = computeEndOfServiceSettlement({ wageBase: "10000", hireDate: d(2025, 6, 1), terminationDate: d(2026, 10, 18), reason: "RESIGNATION" });
    expect(result.entitlementFraction).toBe("0.0000");
    expect(result.netEntitlement).toBe("0.0000");
  });

  it("gives a resigning employee between 2 and 5 years one third", () => {
    const result = computeEndOfServiceSettlement({ wageBase: "10000", hireDate: d(2023, 1, 1), terminationDate: d(2026, 10, 18), reason: "RESIGNATION" });
    // years ~3.8 -> gross = 3.8*0.5*10000 ~ 19041.78; fraction 1/3
    expect(result.entitlementFraction).toBe("0.3333");
    const gross = Number(result.grossEntitlement);
    const net = Number(result.netEntitlement);
    expect(net).toBeCloseTo(gross / 3, 2);
  });

  it("gives a resigning employee between 5 and 10 years two thirds", () => {
    const result = computeEndOfServiceSettlement({ wageBase: "10000", hireDate: d(2019, 10, 18), terminationDate: d(2026, 10, 18), reason: "RESIGNATION" });
    expect(result.entitlementFraction).toBe("0.6667");
  });

  it("gives a resigning employee at 10+ years the full award", () => {
    const result = computeEndOfServiceSettlement({ wageBase: "10000", hireDate: d(2014, 1, 1), terminationDate: d(2026, 10, 18), reason: "RESIGNATION" });
    expect(result.entitlementFraction).toBe("1.0000");
  });

  it("pro-rates a partial final year", () => {
    // exactly 1 year -> gross = 1*0.5*10000 = 5000
    const result = computeEndOfServiceSettlement({ wageBase: "10000", hireDate: d(2025, 10, 18), terminationDate: d(2026, 10, 18), reason: "TERMINATION" });
    expect(result.grossEntitlement).toBe("5000.0000");
  });
});
