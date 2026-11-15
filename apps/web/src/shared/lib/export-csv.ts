/** Escape cells and neutralise spreadsheet formulas in names/reference fields. */
export function csvText(rows: readonly (readonly string[])[]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => {
            const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(cell) ? "'" + cell : cell;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}

export function downloadCsv(name: string, rows: readonly (readonly string[])[]): void {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
