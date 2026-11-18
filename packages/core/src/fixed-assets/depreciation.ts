import { Prisma } from "@erp/db";

// Straight-line depreciation, pro-rated by the day (docs/Planning/fixed-assets-plan.md, ruling D-FA-1 = C).
//
// An asset is written down evenly over every calendar day of its useful life. Instead of adding up rounded daily amounts
// (which drifts), every calculation asks one question: "how much should have been taken in total by the end of day X?"
// That cumulative figure is rounded once, half-up to the currency's minor unit (ADR-0003), and the amount for any stretch
// of days is the difference between two such figures. So the last day of the life always lands the book value exactly
// on the residual value, whatever happened in between.
//
// All dates are UTC midnights of calendar days (the columns are DATE). Pure functions only: no I/O, no clock.

const DAY_MS = 86_400_000;

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(utcDay(date).getTime() + days * DAY_MS);
}

// Days from `from` to `to`, both included (0 when `to` is before `from`).
export function daysInclusive(from: Date, to: Date): number {
  const diff = Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / DAY_MS);
  return diff < 0 ? 0 : diff + 1;
}

// `date` plus whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb).
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

export function isoDay(date: Date): string {
  return utcDay(date).toISOString().slice(0, 10);
}

export interface DepreciationProfile {
  readonly acquisitionCost: Prisma.Decimal;
  readonly residualValue: Prisma.Decimal;
  readonly usefulLifeMonths: number | null;
  readonly inServiceDate: Date;
  // Opening assets: depreciation already taken before this system, as at openingAsOfDate (both null/0 otherwise).
  readonly openingAccumulatedDepreciation: Prisma.Decimal;
  readonly openingAsOfDate: Date | null;
  readonly isDepreciable: boolean;
  // Digits of the currency's minor unit (2 for SAR).
  readonly minorUnitDigits: number;
}

export interface DepreciationWindow {
  // First day the schedule computes over (in-service date, or the day after the opening balance date).
  readonly startDate: Date;
  // Last day of the useful life: the book value reaches the residual value at the end of this day.
  readonly lastDay: Date;
  // cost - residual: what the whole life writes down.
  readonly depreciableAmount: Prisma.Decimal;
}

export class DepreciationProfileError extends Error {
  constructor(
    readonly code: "RESIDUAL_EXCEEDS_COST" | "OPENING_EXCEEDS_DEPRECIABLE" | "LIFE_REQUIRED" | "OPENING_AFTER_LIFE" | "OPENING_DATE_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "DepreciationProfileError";
  }
}

// The window an asset depreciates over, or null when it never depreciates (land, a category marked non-depreciable).
export function depreciationWindow(profile: DepreciationProfile): DepreciationWindow | null {
  if (profile.residualValue.greaterThan(profile.acquisitionCost)) {
    throw new DepreciationProfileError("RESIDUAL_EXCEEDS_COST", "The residual value cannot exceed the cost");
  }
  if (!profile.isDepreciable) return null;
  if (profile.usefulLifeMonths === null || profile.usefulLifeMonths < 1) {
    throw new DepreciationProfileError("LIFE_REQUIRED", "A depreciable asset needs a useful life");
  }
  const depreciableAmount = profile.acquisitionCost.minus(profile.residualValue);
  if (profile.openingAccumulatedDepreciation.greaterThan(depreciableAmount)) {
    throw new DepreciationProfileError("OPENING_EXCEEDS_DEPRECIABLE", "Opening depreciation cannot exceed cost minus residual value");
  }
  const lastDay = addDays(addMonths(profile.inServiceDate, profile.usefulLifeMonths), -1);
  let startDate = utcDay(profile.inServiceDate);
  if (profile.openingAccumulatedDepreciation.greaterThan(0)) {
    if (!profile.openingAsOfDate) throw new DepreciationProfileError("OPENING_DATE_REQUIRED", "Opening depreciation needs the date it is stated at");
    startDate = addDays(profile.openingAsOfDate, 1);
    if (startDate > lastDay && profile.openingAccumulatedDepreciation.lessThan(depreciableAmount)) {
      throw new DepreciationProfileError("OPENING_AFTER_LIFE", "The useful life has already ended at the opening date, so opening depreciation must equal cost minus residual value");
    }
  } else if (profile.openingAsOfDate) {
    // An opening asset with nothing taken yet still starts the day after its opening date (it was not depreciated before).
    const dayAfter = addDays(profile.openingAsOfDate, 1);
    if (dayAfter > startDate) startDate = dayAfter;
  }
  return { startDate, lastDay, depreciableAmount };
}

// Total depreciation that should have been taken by the end of `date` (opening amount included), rounded to the minor unit.
export function targetAccumulated(profile: DepreciationProfile, window: DepreciationWindow, date: Date): Prisma.Decimal {
  const opening = profile.openingAccumulatedDepreciation;
  const day = utcDay(date);
  if (day >= window.lastDay) return window.depreciableAmount;
  if (day < window.startDate) return opening;
  const remaining = window.depreciableAmount.minus(opening);
  const totalDays = daysInclusive(window.startDate, window.lastDay);
  const elapsed = daysInclusive(window.startDate, day);
  const share = remaining.times(elapsed).div(totalDays).toDecimalPlaces(profile.minorUnitDigits, Prisma.Decimal.ROUND_HALF_UP);
  return opening.plus(share);
}

export interface DepreciationSlice {
  readonly fromDate: Date;
  readonly toDate: Date;
  readonly days: number;
  readonly amount: Prisma.Decimal;
  readonly accumulatedAfter: Prisma.Decimal;
  readonly fullyDepreciated: boolean;
}

// What to take now to bring the asset from `accumulated` (taken through `depreciatedThrough`) up to the end of `through`.
// null when there is nothing to take (not yet in service, already at the residual value, or a zero-amount stretch).
export function sliceThrough(
  profile: DepreciationProfile,
  accumulated: Prisma.Decimal,
  depreciatedThrough: Date | null,
  through: Date,
): DepreciationSlice | null {
  const window = depreciationWindow(profile);
  if (!window) return null;
  if (accumulated.greaterThanOrEqualTo(window.depreciableAmount)) return null;
  const firstOpenDay = depreciatedThrough ? addDays(depreciatedThrough, 1) : window.startDate;
  const fromDate = firstOpenDay < window.startDate ? window.startDate : firstOpenDay;
  const toDate = utcDay(through) > window.lastDay ? window.lastDay : utcDay(through);
  if (toDate < fromDate) return null;
  const target = targetAccumulated(profile, window, toDate);
  const amount = target.minus(accumulated);
  if (amount.lessThanOrEqualTo(0)) return null;
  return {
    fromDate,
    toDate,
    days: daysInclusive(fromDate, toDate),
    amount,
    accumulatedAfter: target,
    fullyDepreciated: target.greaterThanOrEqualTo(window.depreciableAmount),
  };
}

export interface ScheduleRow {
  readonly year: number;
  readonly month: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly days: number;
  readonly amount: string;
  readonly accumulated: string;
  readonly netBookValue: string;
}

// The whole expected schedule, month by month, from the window start to the last day of the life.
export function projectedSchedule(profile: DepreciationProfile): ScheduleRow[] {
  const window = depreciationWindow(profile);
  if (!window) return [];
  const rows: ScheduleRow[] = [];
  let accumulated = profile.openingAccumulatedDepreciation;
  let through: Date | null = window.startDate > window.lastDay ? window.lastDay : addDays(window.startDate, -1);
  let year = window.startDate.getUTCFullYear();
  let month = window.startDate.getUTCMonth() + 1;
  // A life is at most 1200 months; the guard only protects against a programming error.
  for (let guard = 0; guard < 1300; guard++) {
    const slice = sliceThrough(profile, accumulated, through, monthEnd(year, month));
    if (slice) {
      accumulated = slice.accumulatedAfter;
      through = slice.toDate;
      rows.push({
        year,
        month,
        fromDate: isoDay(slice.fromDate),
        toDate: isoDay(slice.toDate),
        days: slice.days,
        amount: slice.amount.toFixed(4),
        accumulated: accumulated.toFixed(4),
        netBookValue: profile.acquisitionCost.minus(accumulated).toFixed(4),
      });
      if (slice.fullyDepreciated) break;
    }
    if (monthEnd(year, month) >= window.lastDay) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return rows;
}
