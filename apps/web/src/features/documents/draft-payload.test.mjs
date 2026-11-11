import { test } from "node:test";
import assert from "node:assert/strict";
import { reviveDraftPayload } from "./draft-payload.ts";
test("restores calendar dates without converting notes, descriptions or decimal strings", () => {
  const iso = "2026-11-11T00:00:00.000Z";
  const value = reviveDraftPayload({
    documentDate: iso,
    dueDate: null,
    notes: iso,
    lines: [{ description: iso, quantity: "1.0050" }],
  });
  assert.equal(value.documentDate.toISOString(), iso);
  assert.equal(value.dueDate, null);
  assert.equal(value.notes, iso);
  assert.equal(value.lines[0].description, iso);
  assert.equal(value.lines[0].quantity, "1.0050");
});
