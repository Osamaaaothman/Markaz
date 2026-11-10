import { test } from "node:test";
import assert from "node:assert/strict";
import { requestLinesForOrder } from "./request-lines.ts";

test("copies all request items without truncating integer or fractional quantities and leaves prices empty", () => {
  const lines = [{ itemId: "a", quantity: "100" }, { itemId: "b", quantity: "100.0000" }, { itemId: "c", quantity: "0.0500" }];
  assert.deepEqual(requestLinesForOrder(lines, "vat"), [
    { itemId: "a", quantity: "100", unitPrice: "", taxCodeId: "vat" },
    { itemId: "b", quantity: "100", unitPrice: "", taxCodeId: "vat" },
    { itemId: "c", quantity: "0.05", unitPrice: "", taxCodeId: "vat" },
  ]);
  assert.equal(lines[1].quantity, "100.0000");
});
