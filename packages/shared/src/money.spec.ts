import { CurrencyMismatchError, Money } from "./money.js";

describe("Money", () => {
  describe("arithmetic", () => {
    it("adds and subtracts within the same currency", () => {
      const a = Money.of("10.50", "SAR");
      const b = Money.of("2.25", "SAR");
      expect(a.add(b).toDecimalString()).toBe("12.75");
      expect(a.subtract(b).toDecimalString()).toBe("8.25");
    });

    it("throws CurrencyMismatchError when adding different currencies", () => {
      const a = Money.of("10", "SAR");
      const b = Money.of("10", "USD");
      expect(() => a.add(b)).toThrow(CurrencyMismatchError);
      expect(() => a.subtract(b)).toThrow(CurrencyMismatchError);
      expect(() => a.compareTo(b)).toThrow(CurrencyMismatchError);
    });

    it("never loses precision the way JS floating point does (0.1 + 0.2 case)", () => {
      const a = Money.of("0.1", "SAR");
      const b = Money.of("0.2", "SAR");
      expect(a.add(b).toDecimalString()).toBe("0.30");
    });

    it("scales by a plain factor (tax rate, quantity)", () => {
      const price = Money.of("100", "SAR");
      expect(price.multiply("0.15").toDecimalString()).toBe("15.00");
      expect(price.multiply(3).toDecimalString()).toBe("300.00");
    });
  });

  describe("rounding — half-up to the minor unit, the boundary cases", () => {
    it("rounds .005 up (half-up, not banker's rounding)", () => {
      expect(Money.of("1.005", "SAR").round().toDecimalString()).toBe("1.01");
    });

    it("rounds .015 up", () => {
      expect(Money.of("1.015", "SAR").round().toDecimalString()).toBe("1.02");
    });

    it("rounds .025 up", () => {
      expect(Money.of("1.025", "SAR").round().toDecimalString()).toBe("1.03");
    });

    it("rounds negative amounts half-up in magnitude away from zero", () => {
      // decimal.js ROUND_HALF_UP rounds away from zero for negatives, matching the
      // conventional accounting meaning of "half-up" (not toward positive infinity).
      expect(Money.of("-1.005", "SAR").round().toDecimalString()).toBe("-1.01");
    });

    it("handles very large amounts without precision loss", () => {
      const huge = Money.of("999999999999.995", "SAR");
      expect(huge.round().toDecimalString()).toBe("1000000000000.00");
    });

    it("respects a currency with 0 minor-unit digits (e.g. JPY)", () => {
      expect(Money.of("100.5", "JPY").round().toDecimalString()).toBe("101");
    });

    it("respects a currency with 3 minor-unit digits (e.g. KWD)", () => {
      expect(Money.of("1.2345", "KWD").round().toDecimalString()).toBe("1.235");
    });

    it("accepts an explicit minorUnitDigits override from the currencies table", () => {
      // round() and toDecimalString() take independent digit counts on purpose —
      // a caller that rounds to a non-default precision must say so again when
      // rendering, otherwise toDecimalString() falls back to the currency's normal
      // minor unit (2 for SAR) and would re-truncate the very value just rounded.
      expect(Money.of("1.005", "SAR").round(3).toDecimalString(3)).toBe("1.005");
    });
  });

  describe("comparisons", () => {
    it("isZero/isPositive/isNegative are mutually exclusive and correct", () => {
      expect(Money.zero("SAR").isZero()).toBe(true);
      expect(Money.zero("SAR").isPositive()).toBe(false);
      expect(Money.of("1", "SAR").isPositive()).toBe(true);
      expect(Money.of("-1", "SAR").isNegative()).toBe(true);
    });

    it("equals compares both amount and currency", () => {
      expect(Money.of("10", "SAR").equals(Money.of("10", "SAR"))).toBe(true);
      expect(Money.of("10", "SAR").equals(Money.of("10", "USD"))).toBe(false);
      expect(Money.of("10", "SAR").equals(Money.of("10.01", "SAR"))).toBe(false);
    });
  });

  describe("serialisation", () => {
    it("serialises to a plain decimal string, never a JS number", () => {
      const money = Money.of("42.50", "SAR");
      expect(JSON.stringify({ amount: money })).toBe('{"amount":"42.50"}');
      expect(typeof money.toJSON()).toBe("string");
    });

    it("always shows the currency's minor unit digits, even for a whole number", () => {
      // decimal.js has no notion of "trailing zero precision" on its own — a value
      // that is mathematically 10 must still render as "10.00" for SAR, otherwise
      // an invoice total would inconsistently show "10" some of the time.
      expect(Money.of("10", "SAR").toDecimalString()).toBe("10.00");
    });

    it("accepts an explicit precision override for values that intentionally carry more (e.g. a unit price)", () => {
      expect(Money.of("1.2345", "SAR").toDecimalString(4)).toBe("1.2345");
    });
  });

  describe("a long chain of typical operations still ties out exactly", () => {
    it("balances after many additions and subtractions", () => {
      let running = Money.zero("SAR");
      const amounts = ["10.10", "20.20", "-5.05", "100.00", "-124.99", "0.01"];
      for (const amount of amounts) {
        running = running.add(Money.of(amount, "SAR"));
      }
      expect(running.toDecimalString()).toBe("0.27");
    });
  });
});
