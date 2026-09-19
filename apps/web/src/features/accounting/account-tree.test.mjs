// Run with: node --experimental-strip-types --test (wired into `npm test`). Same approach as
// packages/db/scripts/coa-template.test.mjs — no test framework dependency for pure logic.
import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountTree, expandedKeysForLevel, filterAccountTree } from "./account-tree.ts";

function account(id, code, name, nameAr, parentId, isPostable = false) {
  return { id, code, name, nameAr, type: "ASSET", isPostable, parentId };
}

// 1 > 11 > 11101 > (1110101 Petty Cash, 1110102 Cash on hand), 11102 Bank Accounts ; 2 Liabilities
const accounts = [
  account("a1", "1", "Assets", "الأصول", null),
  account("a11", "11", "Current Assets", "الأصول المتداولة", "a1"),
  account("a11101", "11101", "Cash Accounts", "حسابات النقدية", "a11"),
  account("a1110101", "1110101", "Petty Cash", "العهد النقدية", "a11101", true),
  account("a1110102", "1110102", "Cash on hand", "النقدية بالصندوق", "a11101", true),
  account("a11102", "11102", "Bank Accounts", "الحسابات البنكية", "a11"),
  account("a2", "2", "Liabilities", null, null),
];

const tree = buildAccountTree(accounts);
const keysOf = (nodes) => nodes.flatMap((n) => [n.data.code, ...keysOf(n.children)]);

test("buildAccountTree nests by parentId and records depth and child count", () => {
  assert.deepEqual(tree.map((n) => n.data.code), ["1", "2"]);
  const petty = tree[0].children[0].children[0].children[0];
  assert.equal(petty.data.code, "1110101");
  assert.equal(petty.data.depth, 3);
  assert.equal(tree[0].data.depth, 0);
  assert.equal(tree[0].children[0].children[0].data.childCount, 2);
  assert.equal(petty.data.childCount, 0);
});

test("an account whose parent is missing becomes a root instead of disappearing", () => {
  const orphaned = buildAccountTree([account("x", "9", "Orphan", null, "missing-parent")]);
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0].data.depth, 0);
});

test("expandedKeysForLevel opens exactly the levels above the chosen one", () => {
  assert.deepEqual(Object.keys(expandedKeysForLevel(tree, 1)), []);
  assert.deepEqual(Object.keys(expandedKeysForLevel(tree, 2)), ["a1"]);
  assert.deepEqual(Object.keys(expandedKeysForLevel(tree, 3)).sort(), ["a1", "a11"]);
  assert.deepEqual(Object.keys(expandedKeysForLevel(tree, "all")).sort(), ["a1", "a11", "a11101"]);
});

test("an empty query returns everything and forces nothing open", () => {
  const result = filterAccountTree(tree, "   ");
  assert.equal(keysOf(result.tree).length, accounts.length);
  assert.deepEqual(result.expandedKeys, {});
});

test("search finds English names and keeps and opens every ancestor", () => {
  const result = filterAccountTree(tree, "petty");
  assert.deepEqual(keysOf(result.tree), ["1", "11", "11101", "1110101"]);
  assert.deepEqual(Object.keys(result.expandedKeys).sort(), ["a1", "a11", "a11101"]);
});

test("search finds Arabic names and codes", () => {
  assert.deepEqual(keysOf(filterAccountTree(tree, "العهد").tree), ["1", "11", "11101", "1110101"]);
  assert.deepEqual(keysOf(filterAccountTree(tree, "1110102").tree), ["1", "11", "11101", "1110102"]);
});

test("a matching group with no matching descendants keeps its subtree but stays collapsed", () => {
  const result = filterAccountTree(tree, "bank");
  assert.deepEqual(keysOf(result.tree), ["1", "11", "11102"]);
  const cash = filterAccountTree(tree, "cash accounts");
  assert.deepEqual(keysOf(cash.tree), ["1", "11", "11101", "1110101", "1110102"]);
  assert.equal(cash.expandedKeys["a11101"], undefined);
});

test("a matching group that also has matching descendants shows only the matching descendants", () => {
  const result = filterAccountTree(tree, "cash");
  assert.deepEqual(keysOf(result.tree), ["1", "11", "11101", "1110101", "1110102"]);
  assert.equal(result.expandedKeys["a11101"], true);
});

test("search is case-insensitive and returns nothing for no match", () => {
  assert.equal(keysOf(filterAccountTree(tree, "LIABILITIES").tree).join(), "2");
  assert.deepEqual(filterAccountTree(tree, "zzz").tree, []);
});
