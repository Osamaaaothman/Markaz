import { isDecimalString } from "./decimal-string.validator.js";

describe("isDecimalString", () => {
  it("accepts plain decimals with up to four places", () => {
    for (const ok of ["0", "10", "10.5", "0.0001", "123456789012345.1234"]) expect(isDecimalString(ok)).toBe(true);
  });

  it("refuses signs, exponents, spaces, extra precision and non-strings", () => {
    for (const bad of ["", "-1", "+1", "1e3", " 1", "1 ", "1,5", "abc", "1.23456", ".5", "5.", "1234567890123456"]) {
      expect(isDecimalString(bad)).toBe(false);
    }
    expect(isDecimalString(5)).toBe(false);
    expect(isDecimalString(null)).toBe(false);
  });

  it("refuses zero only when positive is required", () => {
    expect(isDecimalString("0.0000")).toBe(true);
    expect(isDecimalString("0.0000", { positive: true })).toBe(false);
    expect(isDecimalString("0.0001", { positive: true })).toBe(true);
  });
});
