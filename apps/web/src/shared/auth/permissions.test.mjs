import assert from "node:assert/strict";
import test from "node:test";
import { hasAllPermissions, hasAnyPermission, hasPermission } from "./permissions.ts";

const granted = new Set(["journal_entry:read", "account:read"]);

test("hasPermission checks one exact code", () => {
  assert.equal(hasPermission(granted, "journal_entry:read"), true);
  assert.equal(hasPermission(granted, "journal_entry:create"), false);
});

test("hasAnyPermission is true when at least one is granted and when nothing is required", () => {
  assert.equal(hasAnyPermission(granted, ["user:read", "account:read"]), true);
  assert.equal(hasAnyPermission(granted, ["user:read", "role:read"]), false);
  assert.equal(hasAnyPermission(granted, []), true);
});

test("hasAllPermissions needs every code", () => {
  assert.equal(hasAllPermissions(granted, ["journal_entry:read", "account:read"]), true);
  assert.equal(hasAllPermissions(granted, ["journal_entry:read", "account:create"]), false);
});

test("a user with no permissions passes only the empty requirement", () => {
  const none = new Set();
  assert.equal(hasAnyPermission(none, []), true);
  assert.equal(hasAnyPermission(none, ["account:read"]), false);
});
