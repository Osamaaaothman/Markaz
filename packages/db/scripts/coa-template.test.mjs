// Guards the seeded chart-of-accounts template (prisma/coa-template.json): a bad row here
// would ship to every new tenant, and account types can never be corrected once posted to
// (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { accounts } = JSON.parse(readFileSync(new URL("../prisma/coa-template.json", import.meta.url), "utf8"));
const byCode = new Map(accounts.map((a) => [a.code, a]));
const TYPES = new Set(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

test("codes are unique and use only letters and digits", () => {
  assert.equal(byCode.size, accounts.length);
  for (const a of accounts) assert.match(a.code, /^[A-Za-z0-9]+$/, a.code);
});

test("every account has an English and an Arabic name", () => {
  for (const a of accounts) {
    assert.ok(a.name?.trim(), `${a.code} missing name`);
    assert.ok(a.nameAr?.trim(), `${a.code} missing nameAr`);
  }
});

test("type and normal balance are valid and consistent", () => {
  for (const a of accounts) {
    assert.ok(TYPES.has(a.type), `${a.code} bad type ${a.type}`);
    const natural = a.type === "ASSET" || a.type === "EXPENSE" ? "DEBIT" : "CREDIT";
    if (a.normalBalance !== natural) {
      // Only documented contra accounts may deviate.
      assert.ok(a.note, `${a.code} has a non-natural normal balance without a note`);
    }
  }
});

test("parents are listed before their children and every child code starts with its parent's code", () => {
  const seen = new Set();
  for (const a of accounts) {
    if (a.parentCode) {
      assert.ok(seen.has(a.parentCode), `${a.code}: parent ${a.parentCode} not listed before it`);
      assert.ok(a.code.startsWith(a.parentCode), `${a.code} does not extend ${a.parentCode}`);
    }
    seen.add(a.code);
  }
});

test("only leaf accounts are postable", () => {
  const parents = new Set(accounts.map((a) => a.parentCode).filter(Boolean));
  for (const a of accounts) {
    if (a.isPostable) assert.ok(!parents.has(a.code), `${a.code} is postable but has children`);
  }
});

test("a child has the same type as its parent, except under the documented mixed income/cost headers", () => {
  for (const a of accounts) {
    if (!a.parentCode) continue;
    const parent = byCode.get(a.parentCode);
    if (parent.type !== a.type) {
      assert.ok(parent.note, `${a.code} (${a.type}) differs from parent ${parent.code} (${parent.type}) with no note`);
    }
  }
});
