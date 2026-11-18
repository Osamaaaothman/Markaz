import { Prisma } from "@erp/db";
import type { BotLanguage } from "./bot-core.js";

// Display formatting for chat messages. Amounts arrive as decimal strings and are formatted with
// decimal arithmetic — never through a JavaScript number (CLAUDE.md invariant 3).

function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatDecimal(value: string, fractionDigits = 2): string {
  const fixed = new Prisma.Decimal(value).toDecimalPlaces(fractionDigits, Prisma.Decimal.ROUND_HALF_UP).toFixed(fractionDigits);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = "0", fraction] = unsigned.split(".");
  const body = fraction !== undefined ? `${groupThousands(intPart)}.${fraction}` : groupThousands(intPart);
  return negative ? `-${body}` : body;
}

export function formatQuantity(value: string): string {
  // Up to 4 decimals, trailing zeros dropped ("12.5000" → "12.5").
  const fixed = new Prisma.Decimal(value).toDecimalPlaces(4).toFixed();
  const [intPart = "0", fraction] = fixed.replace(/^-/, "").split(".");
  const body = fraction ? `${groupThousands(intPart)}.${fraction}` : groupThousands(intPart);
  return fixed.startsWith("-") ? `-${body}` : body;
}

export class BotFormatter {
  private readonly dateFormat: Intl.DateTimeFormat;
  private readonly dateTimeFormat: Intl.DateTimeFormat;

  constructor(
    readonly language: BotLanguage,
    readonly timezone: string,
  ) {
    // Arabic in Saudi Arabia defaults to the Hijri calendar and Arabic-Indic digits; business
    // documents here use the Gregorian calendar and Latin digits, so both are pinned.
    const locale = language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
    this.dateFormat = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", year: "numeric" });
    this.dateTimeFormat = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  money(amount: string, currency: string): string {
    const value = formatDecimal(amount);
    return this.language === "ar" ? `${value} ${currency}` : `${currency} ${value}`;
  }

  quantity(value: string): string {
    return formatQuantity(value);
  }

  // A calendar date "YYYY-MM-DD" (no time zone shift) or an ISO timestamp.
  date(value: string | Date): string {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return this.dateFormat.format(new Date(`${value}T12:00:00Z`));
    }
    return this.dateFormat.format(typeof value === "string" ? new Date(value) : value);
  }

  dateTime(value: Date): string {
    return this.dateTimeFormat.format(value);
  }
}

// "HH:MM" wall-clock time and weekday (0 = Sunday) of an instant in a time zone.
export function zonedClock(now: Date, timezone: string): { readonly hhmm: string; readonly weekday: number; readonly date: string; readonly day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hhmm: `${hour}:${get("minute")}`,
    weekday: weekdays.indexOf(get("weekday")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    day: Number(get("day")),
  };
}

// True when `hhmm` falls inside a quiet window that may cross midnight ("22:00"–"07:00").
export function inQuietHours(hhmm: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}
