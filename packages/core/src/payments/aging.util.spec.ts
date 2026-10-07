import { bucketFor, daysPastDue } from "./aging.util.js";

describe("daysPastDue", () => {
  it("counts calendar days, positive when overdue", () => {
    expect(daysPastDue("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysPastDue("2026-01-31", "2026-01-01")).toBe(-30);
    expect(daysPastDue("2026-03-01", "2026-03-01")).toBe(0);
  });

  it("is not thrown off by a daylight-saving change", () => {
    expect(daysPastDue("2026-03-20", "2026-04-20")).toBe(31);
    expect(daysPastDue("2026-10-20", "2026-11-20")).toBe(31);
  });
});

describe("bucketFor", () => {
  it("puts not-yet-due and due-today in current", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
  });

  it("splits at 30, 60 and 90 days", () => {
    expect(bucketFor(1)).toBe("days1to30");
    expect(bucketFor(30)).toBe("days1to30");
    expect(bucketFor(31)).toBe("days31to60");
    expect(bucketFor(60)).toBe("days31to60");
    expect(bucketFor(61)).toBe("days61to90");
    expect(bucketFor(90)).toBe("days61to90");
    expect(bucketFor(91)).toBe("over90");
  });
});
