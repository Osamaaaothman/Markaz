export interface AuditField {
  path: string[];
  before: unknown;
  after: unknown;
  changed: boolean;
}
function flatten(
  value: unknown,
  path: string[] = [],
  result = new Map<string, { path: string[]; value: unknown }>(),
): typeof result {
  if (value !== null && typeof value === "object" && Object.keys(value).length && path.length < 8) {
    for (const [key, child] of Object.entries(value)) flatten(child, [...path, key], result);
  } else if (path.length) result.set(JSON.stringify(path), { path, value });
  return result;
}
// Missing snapshots are not an empty prior state: never invent a before value for older events.
const fieldOrder = [
  "number",
  "ref",
  "code",
  "documentType",
  "status",
  "nameAr",
  "name",
  "customerNameAr",
  "customerName",
  "supplierNameAr",
  "supplierName",
  "invoiceDate",
  "dueDate",
  "currency",
  "totalNet",
  "totalTax",
  "totalGross",
  "amount",
  "notes",
  "reason",
  "journalEntryId",
  "originalInvoiceId",
  "purchaseOrderId",
  "salesOrderId",
  "lines",
  "lineNumber",
  "description",
  "quantity",
  "unitPrice",
  "netAmount",
  "taxRate",
  "taxAmount",
];
function comparePaths(left: string[], right: string[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? "",
      b = right[i] ?? "";
    if (a === b) continue;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
    const rank = (key: string): number => {
      const index = fieldOrder.indexOf(key);
      return index >= 0 ? index : key === "id" || key.endsWith("Id") ? 1000 : 500;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  }
  return 0;
}
export function auditFields(before: unknown, after: unknown): AuditField[] {
  const left = flatten(before),
    right = flatten(after);
  return [...new Set([...left.keys(), ...right.keys()])]
    .map((key) => ({
      path: (left.get(key) ?? right.get(key))!.path,
      before: left.get(key)?.value,
      after: right.get(key)?.value,
      changed: JSON.stringify(left.get(key)?.value) !== JSON.stringify(right.get(key)?.value),
    }))
    .sort((a, b) => comparePaths(a.path, b.path));
}
export function recordedNumber(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  for (const key of ["number", "code", "ref"])
    if (typeof record[key] === "string") return record[key];
  return null;
}
export function auditSeverity(action: string): "success" | "danger" | "warning" | "info" {
  if (/(rejected|cancelled|failed|deleted|revoked)$/.test(action)) return "danger";
  if (/(reversed|updated|changed|set)$/.test(action)) return "warning";
  if (/(created|posted|approved|accepted|sent|delivered|imported|recorded|settled)$/.test(action))
    return "success";
  return "info";
}
