import assert from "node:assert/strict";
import test from "node:test";
import { csvRows, importTable } from "./import-table.ts";

test("CSV preserves Arabic, multiline quoted cells, identifiers and decimal precision", () => {
  const rows = importTable(csvRows('\uFEFFcode,name,reorderPoint\r\n0001,"قلم, أحمر\n""مميز""",999999999999999.9999\r\n'));
  assert.equal(rows[0].values.code, "0001");
  assert.equal(rows[0].values.name, 'قلم, أحمر\n"مميز"');
  assert.equal(rows[0].values.reorderPoint, "999999999999999.9999");
});
test("semicolon CSV and blank lines retain actual source row numbers", () => {
  assert.deepEqual(importTable(csvRows('code;name\n;\n01;A'))[0], { rowNumber: 3, values: { code: "01", name: "A" } });
});
test("malformed quoting, duplicate headers and unlabeled cells fail rather than lose data", () => {
  for (const source of ['a,b\n"unclosed', 'a,b\n"x"bad,y', 'a,b\nx"y,z']) assert.throws(() => csvRows(source), /INVALID_FILE/);
  for (const source of ['a,a\nx,y', 'a,b\nx,y,z', '__proto__,b\nx,y']) assert.throws(() => importTable(csvRows(source)), /INVALID_HEADERS/);
});
test("limit is 200 nonempty rows and headers alone cannot be imported", () => {
  assert.throws(() => importTable([["code"]]), /ROW_LIMIT/);
  assert.equal(importTable([["code"], ...Array.from({ length: 200 }, (_, i) => [String(i)])]).length, 200);
  assert.throws(() => importTable([["code"], ...Array.from({ length: 201 }, () => ["x"])]), /ROW_LIMIT/);
});
