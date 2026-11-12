import { readSheet } from "read-excel-file/web-worker";

import { csvRows, importTable } from "./import-table";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (file.size > 2 * 1024 * 1024) throw new Error("FILE_LIMIT");
    const extension = file.name.toLowerCase().split(".").pop();
    let table: unknown[][];
    if (extension === "csv") table = csvRows((await file.text()).replace(/^\uFEFF/, ""));
    else if (extension === "xlsx") {
      // Bound the declared expanded ZIP size before handing the workbook to its parser.
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      let expanded = 0;
      let entries = 0;
      for (let i = 0; i + 46 <= view.byteLength; i++)
        if (view.getUint32(i, true) === 0x02014b50) {
          expanded += view.getUint32(i + 24, true);
          entries++;
          if (expanded > 10 * 1024 * 1024 || entries > 1000 || view.getUint16(i + 8, true) & 1)
            throw new Error("FILE_LIMIT");
        }
      if (!entries) throw new Error("INVALID_FILE");
      table = await readSheet(file, 1, { parseNumber: (text) => text });
    } else throw new Error("INVALID_FILE");
    const rows = importTable(table);
    self.postMessage({ rows });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error &&
        ["FILE_LIMIT", "INVALID_HEADERS", "ROW_LIMIT"].includes(error.message)
          ? error.message
          : "INVALID_FILE",
    });
  }
};
