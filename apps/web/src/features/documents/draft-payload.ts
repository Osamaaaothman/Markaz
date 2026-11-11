const DATE_FIELDS = new Set([
  "date",
  "secondDate",
  "documentDate",
  "orderDate",
  "expectedDate",
  "invoiceDate",
  "dueDate",
  "entryDate",
  "postingDate",
]);

/** Only form date fields are revived; a note that happens to be ISO text stays text. */
export function reviveDraftPayload<T>(payload: unknown): T {
  return JSON.parse(JSON.stringify(payload), (key, value: unknown) =>
    DATE_FIELDS.has(key) &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      ? new Date(value)
      : value,
  ) as T;
}
