import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePaymentAmount } from "./payment-amount.ts";

test("accepts Arabic and Persian digits and decimal/thousands separators without floating point", () => {
  assert.equal(normalizePaymentAmount(" ١٬٢٣٤٫٥٦٧٨ "), "1234.5678");
  assert.equal(normalizePaymentAmount("۱۲۳٫۴۵"), "123.45");
  assert.equal(normalizePaymentAmount("999999999999999.9999"), "999999999999999.9999");
  assert.equal(normalizePaymentAmount("1."), "1.");
  assert.equal(normalizePaymentAmount(""), "");
  assert.equal(normalizePaymentAmount("-١"), "-1");
});
