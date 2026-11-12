/** Parse CSV without evaluating formulas or coercing identifiers/decimal strings. */
export function csvRows(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  // Detect the separator outside quoted cells on the header record.
  let inside = false;
  let commas = 0;
  let semicolons = 0;
  for (const c of text) {
    if (c === '"') inside = !inside;
    else if (!inside && c === "\n") break;
    else if (!inside && c === ",") commas++;
    else if (!inside && c === ";") semicolons++;
  }
  const delimiter = semicolons > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === delimiter || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== delimiter) {
        rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("INVALID_FILE");
      cell += c;
    }
  }
  if (quoted) throw new Error("INVALID_FILE");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function importTable(table: readonly (readonly unknown[])[]) {
  const text = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      return String(value);
    throw new Error("INVALID_FILE");
  };
  const headers = table[0]?.map((value) => text(value).trim()) ?? [];
  if (
    !headers.length ||
    headers.length > 20 ||
    headers.some((h) => !h || ["__proto__", "constructor", "prototype"].includes(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("INVALID_HEADERS");
  const rows = table
    .slice(1)
    .map((cells, index) => {
      if (cells.slice(headers.length).some((cell) => text(cell).trim()))
        throw new Error("INVALID_HEADERS");
      return {
        rowNumber: index + 2,
        values: Object.fromEntries(headers.map((header, col) => [header, text(cells[col])])),
      };
    })
    .filter((row) => Object.values(row.values).some((value) => value.trim()));
  if (!rows.length || rows.length > 200) throw new Error("ROW_LIMIT");
  return rows;
}
