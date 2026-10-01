// docs/04-DATA-MODEL-RULES.md §3, the INPUT side: PrimeReact's Calendar returns a
// native JS Date representing midnight in the browser's LOCAL timezone. Calling
// `.toISOString()` on it converts to UTC and silently shifts the calendar date by
// one day for any viewer whose local timezone has a non-zero offset — the exact
// bug this rule already made the backend guard against, just reachable from the
// frontend's own date picker instead. Extracting the local Y-M-D directly (never
// going through a UTC conversion of a local-midnight Date) is what a `@db.Date`
// field on the wire needs: the calendar date the user actually clicked, not a
// timestamp.
export function toDateOnlyIsoString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// docs/04-DATA-MODEL-RULES.md §3: a calendar-fact date (entryDate, postingDate,
// fiscal period boundaries) must never round-trip through a local-timezone Date
// construction — `new Date(isoString).toLocaleDateString()` renders the PREVIOUS
// day for any viewer whose local timezone is behind UTC, because the ISO string
// is midnight UTC and `toLocaleDateString` converts it to the browser's local
// wall-clock time first. This formats the date parts directly instead.
export function formatCalendarDate(isoDateString: string, locale: string): string {
  const datePart = isoDateString.slice(0, 10); // "YYYY-MM-DD", already correct
  const [year, month, day] = datePart.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Not a calendar date string: "${isoDateString}"`);
  }
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}
