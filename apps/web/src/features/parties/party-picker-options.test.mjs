import assert from "node:assert/strict";
import { test } from "node:test";
import { partyPickerOptions } from "./party-picker-options.ts";

const employee = { id: "employee", kind: "EMPLOYEE", name: "موظف / Employee" };
const customers = ["COMPANY", "PERSON", "OTHER"].map((kind) => ({ id: kind, kind }));

test("customer/supplier options exclude employees but retain every other entity kind", () => {
  assert.deepEqual(partyPickerOptions([employee, ...customers], null, true), customers);
});

test("account party options retain employees, including a linked employee outside the search page", () => {
  assert.deepEqual(partyPickerOptions(customers, employee), [employee, ...customers]);
});

test("a current employee cannot bypass the commercial picker filter", () => {
  assert.deepEqual(partyPickerOptions(customers, employee, true), customers);
});

test("eligible current parties remain selectable outside the search page without duplicates", () => {
  assert.deepEqual(partyPickerOptions([], customers[0], true), [customers[0]]);
  assert.deepEqual(partyPickerOptions(customers, customers[0], true), customers);
});

test("fresh search data overrides a linked party's old kind before filtering", () => {
  assert.deepEqual(partyPickerOptions([employee], { ...employee, kind: "PERSON" }, true), []);
  assert.deepEqual(partyPickerOptions(undefined, null, true), []);
});
