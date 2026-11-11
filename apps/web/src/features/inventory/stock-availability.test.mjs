import { test } from "node:test";
import assert from "node:assert/strict";
import { stockAvailability } from "./stock-availability.ts";
test("duplicates are accumulated exactly and warehouses are independent", () => {
  const lines = [
    { itemId: "a", warehouseId: "one", quantity: "0.1" },
    { itemId: "a", warehouseId: "one", quantity: "0.2" },
    { itemId: "a", warehouseId: "two", quantity: "2" },
  ];
  const stock = [
    { itemId: "a", warehouseId: "one", quantity: "0.3" },
    { itemId: "a", warehouseId: "two", quantity: "1" },
  ];
  assert.deepEqual(
    stockAvailability(lines, stock).map((s) => s.exceeded),
    [false, false, true],
  );
  lines[1].quantity = "0.2001";
  assert.deepEqual(
    stockAvailability(lines, stock).map((s) => s.exceeded),
    [true, true, true],
  );
});
test("unloaded stock is unknown, absent stock after loading is zero; service lines are unrestricted", () => {
  const lines = [
    { itemId: "a", warehouseId: "one", quantity: "1" },
    { itemId: "", warehouseId: "one", quantity: "999" },
  ];
  assert.equal(stockAvailability(lines, undefined)[0].onHand, null);
  assert.deepEqual(
    stockAvailability(lines, []).map((s) => s.exceeded),
    [true, false],
  );
});
