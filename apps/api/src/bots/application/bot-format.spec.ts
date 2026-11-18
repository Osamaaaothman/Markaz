import { BotFormatter, formatDecimal, formatQuantity, inQuietHours, zonedClock } from "./bot-format.js";

describe("formatDecimal", () => {
  it("groups thousands and keeps the requested fraction digits", () => {
    expect(formatDecimal("1234567.891")).toBe("1,234,567.89");
  });

  it("rounds half-up, away from zero for negatives", () => {
    expect(formatDecimal("-0.005")).toBe("-0.01");
    expect(formatDecimal("0.005")).toBe("0.01");
  });

  it("formats beyond Number.MAX_SAFE_INTEGER without float precision loss", () => {
    expect(formatDecimal("999999999999999999.995")).toBe("1,000,000,000,000,000,000.00");
  });
});

describe("formatQuantity", () => {
  it("drops trailing zeros and groups thousands", () => {
    expect(formatQuantity("12.5000")).toBe("12.5");
    expect(formatQuantity("1000")).toBe("1,000");
  });
});

describe("BotFormatter", () => {
  it("prints money with the currency code leading in English and trailing in Arabic", () => {
    expect(new BotFormatter("en", "Asia/Riyadh").money("48300", "SAR")).toBe("SAR 48,300.00");
    expect(new BotFormatter("ar", "Asia/Riyadh").money("48300", "SAR")).toBe("48,300.00 SAR");
  });

  it("formats Arabic dates on the Gregorian calendar with Latin digits", () => {
    const formatted = new BotFormatter("ar", "Asia/Riyadh").date("2026-11-15");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/[0-9]/);
    expect(formatted).not.toMatch(/[\u0660-\u0669]/);
  });
});

describe("zonedClock", () => {
  it("converts an instant to the wall clock and weekday of the time zone", () => {
    const clock = zonedClock(new Date("2026-11-15T21:30:00Z"), "Asia/Riyadh");
    expect(clock.hhmm).toBe("00:30");
    expect(clock.date).toBe("2026-11-16");
    expect(clock.weekday).toBe(1);
    expect(clock.day).toBe(16);
  });
});

describe("inQuietHours", () => {
  it("handles a window that crosses midnight", () => {
    expect(inQuietHours("23:00", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("06:59", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("07:00", "22:00", "07:00")).toBe(false);
  });

  it("is off when either bound is missing", () => {
    expect(inQuietHours("12:00", null, null)).toBe(false);
  });

  it("handles a window inside one day", () => {
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
  });
});
