// RFC 4180 field escaping — wrap in quotes and double any internal quote whenever a
// field contains a comma, quote, or newline (a plain unquoted field is not touched,
// keeping simple exports readable). No library needed for this; hand-rolling it here
// avoids a new dependency for something this small.
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

// UTF-8 BOM so Excel (the primary consumer of a ".csv" a non-technical user opens)
// detects the encoding correctly instead of mangling Arabic text.
export function toCsvDocument(rows: readonly (readonly string[])[]): string {
  return "﻿" + rows.map(csvRow).join("\r\n") + "\r\n";
}
