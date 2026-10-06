export const AGING_BUCKETS = ["current", "days1to30", "days31to60", "days61to90", "over90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const MS_PER_DAY = 86_400_000;

// Whole days from the due date to the report date (positive = overdue). Both are calendar dates
// ("YYYY-MM-DD"); parsing them as UTC midnight keeps daylight-saving and the viewer's timezone out of it
// (docs/04 §3: a calendar fact is never a local-time Date).
export function daysPastDue(dueDate: string, asOf: string): number {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / MS_PER_DAY);
}

// Not yet due is "current"; then 1-30, 31-60, 61-90 and over 90 days overdue.
export function bucketFor(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "days1to30";
  if (days <= 60) return "days31to60";
  if (days <= 90) return "days61to90";
  return "over90";
}
