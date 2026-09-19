// Run with: node --experimental-strip-types --test (wired into `npm test`).
// Runs against the real seeded chart (packages/db/prisma/coa-template.json) so the numbering
// rules are checked on the data they were derived from, not on invented examples.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inferFromCode, suggestNextCode } from "./account-code.ts";

const template = JSON.parse(
  readFileSync(new URL("../../../../../packages/db/prisma/coa-template.json", import.meta.url), "utf8"),
);
const rows = Array.isArray(template) ? template : template.accounts;

// id = code, so tests can name a parent by its code.
const chart = rows.map((a) => ({
  id: a.code,
  code: a.code,
  name: a.name,
  nameAr: a.nameAr ?? null,
  type: a.type,
  isPostable: a.isPostable,
  parentId: a.parentCode ?? null,
}));

function account(id, code, parentId, isPostable = false, type = "ASSET") {
  return { id, code, name: code, nameAr: null, type, isPostable, parentId };
}

test("the template is what the rules were measured on (guards the fixture)", () => {
  assert.equal(chart.length, 278);
  assert.ok(chart.some((a) => a.code === "11108" && a.parentId === "11"));
});

test("next code under a level-1 root is one digit", () => {
  assert.equal(suggestNextCode(chart, "1", "ASSET"), "16");
});

test("next code under a level-2 group is three digits, after the highest sibling", () => {
  const siblings = chart.filter((a) => a.parentId === "11").map((a) => Number(a.code.slice(2)));
  const expected = `11${Math.max(...siblings) + 1}`;
  assert.equal(suggestNextCode(chart, "11", "ASSET"), expected);
});

test("next code under a level-3 group is two digits and does not fill gaps", () => {
  // 11108 has children 01, 03, 04, 05 — the gap at 02 is left alone.
  assert.equal(suggestNextCode(chart, "11108", "ASSET"), "1110806");
});

test("first child of a level-2 group starts at 101, of a level-3 or 4 group at 01", () => {
  const accounts = [
    account("r", "1", null),
    account("g2", "11", "r"),
    account("g3", "11101", "g2"),
    account("g4", "1110101", "g3"),
    account("g2b", "12", "r"),
  ];
  assert.equal(suggestNextCode(accounts, "g2b", "ASSET"), "12101");
  assert.equal(suggestNextCode(accounts, "g3", "ASSET"), "1110102");
  assert.equal(suggestNextCode(accounts, "g4", "ASSET"), "111010101");
});

test("lettered sibling codes do not affect the count", () => {
  const accounts = [
    account("r", "2", null, false, "LIABILITY"),
    account("g2", "21", "r", false, "LIABILITY"),
    account("g3", "21106", "g2", false, "LIABILITY"),
    account("g4", "2110601", "g3", false, "LIABILITY"),
    account("s1", "2110601A0001", "g4", true),
    account("s2", "2110601A0002", "g4", true),
  ];
  assert.equal(suggestNextCode(accounts, "g4", "LIABILITY"), "211060101");
});

test("no suggestion once the suffix space is full", () => {
  const accounts = [account("r", "1", null)];
  for (let digit = 1; digit <= 9; digit += 1) accounts.push(account(`c${digit}`, `1${digit}`, "r"));
  assert.equal(suggestNextCode(accounts, "r", "ASSET"), null);
});

test("a taken code is skipped, never suggested", () => {
  const accounts = [account("r", "1", null), account("g", "11", "r"), account("x", "11101", "g")];
  // "11102" is used by an account that is not a child of "g" — still must not be suggested.
  accounts.push(account("y", "11102", null));
  assert.equal(suggestNextCode(accounts, "g", "ASSET"), "11103");
});

test("a new top-level account gets its type's digit when free, else the next free digit", () => {
  const accounts = [account("a", "1", null), account("b", "2", null, false, "LIABILITY")];
  assert.equal(suggestNextCode(accounts, null, "EQUITY"), "3");
  assert.equal(suggestNextCode(accounts, null, "ASSET"), "3");
  assert.equal(suggestNextCode(chart, null, "ASSET"), "7");
});

test("an unknown parent gives no suggestion", () => {
  assert.equal(suggestNextCode(chart, "nope", "ASSET"), null);
});

test("typing a code finds the longest existing group that starts it", () => {
  const result = inferFromCode(chart, "111080199");
  assert.equal(result.kind, "parent");
  assert.equal(result.parent.code, "1110801");
});

test("typing a code under a level-3 group finds that group", () => {
  const result = inferFromCode(chart, "1110806");
  assert.equal(result.kind, "parent");
  assert.equal(result.parent.code, "11108");
  assert.equal(result.parent.type, "ASSET");
});

test("an existing code is reported as a duplicate", () => {
  const result = inferFromCode(chart, "1110801");
  assert.equal(result.kind, "duplicate");
  assert.equal(result.account.code, "1110801");
});

test("a postable account cannot be inferred as a parent", () => {
  const result = inferFromCode(chart, "491020201");
  assert.equal(result.kind, "postableParent");
  assert.equal(result.parent.code, "4910202");
});

test("a single unused digit is a top-level account, with its type for digits 1-5", () => {
  assert.deepEqual(inferFromCode(chart, "7"), { kind: "root", type: null });
  assert.deepEqual(inferFromCode([account("a", "1", null)], "2"), { kind: "root", type: "LIABILITY" });
});

test("a longer code that nothing starts, and blank input", () => {
  assert.equal(inferFromCode(chart, "9999").kind, "noParent");
  assert.equal(inferFromCode(chart, "  ").kind, "empty");
});

test("letters in a typed code still find the parent", () => {
  const result = inferFromCode(chart, "1110801A0001");
  assert.equal(result.kind, "parent");
  assert.equal(result.parent.code, "1110801");
});
