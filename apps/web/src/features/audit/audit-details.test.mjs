import { test } from "node:test";
import assert from "node:assert/strict";
import { auditFields, recordedNumber, auditSeverity } from "./audit-details.ts";
import { documentPath } from "../../shared/lib/document-path.ts";
test("compares nested lines and preserves decimal strings, zero and false", () => {
  const rows = auditFields({ lines: [{ quantity: "1.0000", price: "999999999999.9900" }], active: true }, { lines: [{ quantity: "2.0000", price: "999999999999.9900" }], active: false, count: 0 });
  assert.equal(rows.find((r) => r.path.at(-1) === "quantity").changed, true);
  assert.equal(rows.find((r) => r.path.at(-1) === "price").changed, false);
  assert.equal(rows.find((r) => r.path.at(-1) === "price").after, "999999999999.9900");
  assert.equal(rows.find((r) => r.path.at(-1) === "active").after, false);
  assert.equal(rows.find((r) => r.path.at(-1) === "count").after, 0);
});
test("missing snapshots are distinct from explicitly empty values", () => {
  assert.deepEqual(auditFields(null, { notes: null }), [{ path: ["notes"], before: undefined, after: null, changed: true }]);
  assert.deepEqual(auditFields(null, null), []);
  assert.deepEqual(auditFields({ a: { b: "x" } }, { a: { b: "x" } }).map((r) => r.changed), [false]);
  assert.equal(recordedNumber({ number: "INV-12" }), "INV-12");
  assert.equal(recordedNumber(null), null);
});
test("links point to detail pages or URL-backed dialogs and safely encode ids", () => {
  assert.equal(documentPath("sales_invoice", "123"), "/sales/invoices/123");
  assert.equal(documentPath("supplier_invoice", "123"), "/purchasing/invoices/123");
  assert.equal(documentPath("quotation", "123"), "/sales/quotations?view=123");
  assert.equal(documentPath("journal_entry", "x&view=y"), "/accounting/journal-entries?view=x%26view%3Dy");
  assert.equal(documentPath("unknown", "123"), null);
});
test("operations use distinct accessible status categories", () => {
  assert.equal(auditSeverity("sales_invoice.posted"), "success");
  assert.equal(auditSeverity("purchase_request.rejected"), "danger");
  assert.equal(auditSeverity("employee.updated"), "warning");
  assert.equal(auditSeverity("quotation.email_requested"), "info");
});
