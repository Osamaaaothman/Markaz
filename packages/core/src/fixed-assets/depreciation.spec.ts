import { Prisma } from "@erp/db";
import {
  DepreciationProfileError,
  addMonths,
  daysInclusive,
  depreciationWindow,
  monthEnd,
  projectedSchedule,
  sliceThrough,
  type DepreciationProfile,
  type DepreciationSlice,
} from "./depreciation.js";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const D = (v: string | number) => new Prisma.Decimal(v);

function profile(overrides: Partial<DepreciationProfile> = {}): DepreciationProfile {
  return {
    acquisitionCost: D("12000"),
    residualValue: D("0"),
    usefulLifeMonths: 12,
    inServiceDate: d(2026, 1, 1),
    openingAccumulatedDepreciation: D("0"),
    openingAsOfDate: null,
    isDepreciable: true,
    minorUnitDigits: 2,
    ...overrides,
  };
}

describe("date helpers", () => {
  it("adds months and clamps to the end of a short month", () => {
    expect(addMonths(d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
    expect(addMonths(d(2028, 1, 31), 1)).toEqual(d(2028, 2, 29));
    expect(addMonths(d(2026, 11, 15), 3)).toEqual(d(2027, 2, 15));
  });

  it("counts days with both ends included", () => {
    expect(daysInclusive(d(2026, 1, 1), d(2026, 1, 31))).toBe(31);
    expect(daysInclusive(d(2026, 1, 1), d(2026, 12, 31))).toBe(365);
    expect(daysInclusive(d(2028, 1, 1), d(2028, 12, 31))).toBe(366);
    expect(daysInclusive(d(2026, 2, 1), d(2026, 1, 31))).toBe(0);
  });
});

describe("straight line, daily pro-rata", () => {
  it("takes a month's share of the days, and the year adds up exactly to the depreciable amount", () => {
    const p = profile();
    const jan = sliceThrough(p, D(0), null, monthEnd(2026, 1))!;
    // 12000 x 31 / 365 = 1019.178... -> 1019.18
    expect(jan.amount.toFixed(2)).toBe("1019.18");
    expect(jan.days).toBe(31);
    const rows = projectedSchedule(p);
    expect(rows).toHaveLength(12);
    const total = rows.reduce((sum, r) => sum.plus(r.amount), D(0));
    expect(total.toFixed(4)).toBe("12000.0000");
    expect(rows[11]!.netBookValue).toBe("0.0000");
  });

  it("starts on the in-service day, not the first of the month", () => {
    const p = profile({ inServiceDate: d(2026, 1, 16) });
    const jan = sliceThrough(p, D(0), null, monthEnd(2026, 1))!;
    expect(jan.fromDate).toEqual(d(2026, 1, 16));
    expect(jan.days).toBe(16);
    // life: 16 Jan 2026 .. 15 Jan 2027 = 365 days; 12000 x 16 / 365 = 526.03
    expect(jan.amount.toFixed(2)).toBe("526.03");
  });

  it("never takes the book value below the residual value, and ends exactly on it", () => {
    const p = profile({ acquisitionCost: D("10000"), residualValue: D("1000.55"), usefulLifeMonths: 37, inServiceDate: d(2026, 3, 17) });
    const rows = projectedSchedule(p);
    for (const row of rows) expect(D(row.netBookValue).greaterThanOrEqualTo("1000.55")).toBe(true);
    expect(rows[rows.length - 1]!.netBookValue).toBe("1000.5500");
    expect(rows[rows.length - 1]!.toDate).toBe("2029-04-16");
  });

  it("amounts are always whole minor units (halalas)", () => {
    const rows = projectedSchedule(profile({ acquisitionCost: D("9999.99"), usefulLifeMonths: 7, inServiceDate: d(2026, 2, 3) }));
    for (const row of rows) expect(D(row.amount).decimalPlaces()).toBeLessThanOrEqual(2);
  });

  it("catches up several months at once with the same result as month by month", () => {
    const p = profile({ acquisitionCost: D("5000"), usefulLifeMonths: 24, inServiceDate: d(2026, 1, 10) });
    const catchUp = sliceThrough(p, D(0), null, monthEnd(2026, 4))!;
    let acc = D(0);
    let through: Date | null = null;
    for (const m of [1, 2, 3, 4]) {
      const s: DepreciationSlice = sliceThrough(p, acc, through, monthEnd(2026, m))!;
      acc = s.accumulatedAfter;
      through = s.toDate;
    }
    expect(catchUp.accumulatedAfter.toFixed(4)).toBe(acc.toFixed(4));
  });

  it("returns nothing for a non-depreciable asset (land) or before the asset is in service", () => {
    expect(sliceThrough(profile({ isDepreciable: false, usefulLifeMonths: null }), D(0), null, monthEnd(2030, 1))).toBeNull();
    expect(sliceThrough(profile({ inServiceDate: d(2026, 3, 1) }), D(0), null, monthEnd(2026, 2))).toBeNull();
    expect(projectedSchedule(profile({ isDepreciable: false, usefulLifeMonths: null }))).toEqual([]);
  });

  it("returns nothing once fully depreciated", () => {
    const p = profile();
    expect(sliceThrough(p, D("12000"), d(2026, 12, 31), monthEnd(2027, 6))).toBeNull();
  });

  it("refuses a residual value above the cost and a depreciable asset without a life", () => {
    expect(() => depreciationWindow(profile({ residualValue: D("12000.01") }))).toThrow(DepreciationProfileError);
    expect(() => depreciationWindow(profile({ usefulLifeMonths: null }))).toThrow(DepreciationProfileError);
  });

  it("handles a leap-year February", () => {
    const p = profile({ inServiceDate: d(2028, 1, 1), acquisitionCost: D("36600") });
    const feb = sliceThrough(p, D("3100"), d(2028, 1, 31), monthEnd(2028, 2))!;
    expect(feb.days).toBe(29);
    expect(feb.amount.toFixed(2)).toBe("2900.00");
  });
});

describe("opening assets", () => {
  it("spreads what is left over the days left of the life, starting the day after the opening date", () => {
    // Bought 1 Jan 2024 for 36000 over 36 months; 24000 already taken by 31 Dec 2025 -> 12000 left over 2026 (365 days).
    const p = profile({ acquisitionCost: D("36000"), usefulLifeMonths: 36, inServiceDate: d(2024, 1, 1), openingAccumulatedDepreciation: D("24000"), openingAsOfDate: d(2025, 12, 31) });
    const window = depreciationWindow(p)!;
    expect(window.startDate).toEqual(d(2026, 1, 1));
    expect(window.lastDay).toEqual(d(2026, 12, 31));
    const jan = sliceThrough(p, D("24000"), d(2025, 12, 31), monthEnd(2026, 1))!;
    expect(jan.amount.toFixed(2)).toBe("1019.18");
    const rows = projectedSchedule(p);
    expect(rows[rows.length - 1]!.accumulated).toBe("36000.0000");
  });

  it("refuses opening depreciation above cost minus residual", () => {
    expect(() => depreciationWindow(profile({ openingAccumulatedDepreciation: D("12000.01"), openingAsOfDate: d(2026, 6, 30) }))).toThrow(DepreciationProfileError);
  });

  it("an opening asset already at the end of its life has nothing more to take", () => {
    const p = profile({ usefulLifeMonths: 12, inServiceDate: d(2020, 1, 1), openingAccumulatedDepreciation: D("12000"), openingAsOfDate: d(2025, 12, 31) });
    expect(sliceThrough(p, D("12000"), d(2025, 12, 31), monthEnd(2026, 1))).toBeNull();
  });
});
