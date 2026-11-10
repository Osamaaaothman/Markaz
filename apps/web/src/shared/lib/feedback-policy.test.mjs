import { test } from "node:test";
import assert from "node:assert/strict";
import { successFeedback } from "./feedback-policy.ts";

test("silent actions and existing result dialogs do not also emit success toasts", () => {
  assert.equal(successFeedback({}, { feedback: "silent" }), null);
  assert.equal(successFeedback({}, { feedback: "dialog" }), null);
});
test("unannotated mutations receive feedback and specific action labels are supported", () => {
  assert.deepEqual(successFeedback(undefined), { severity: "success", key: "feedback.saved" });
  assert.deepEqual(successFeedback({}, { successKey: "feedback.deleted" }), { severity: "success", key: "feedback.deleted" });
});
test("partial batch failures and skipped records never claim complete success", () => {
  assert.deepEqual(successFeedback({ ok: false }), { severity: "error", key: "feedback.failed" });
  assert.deepEqual(successFeedback({ failed: [{ ref: "employee" }] }), { severity: "warn", key: "feedback.partial" });
  assert.deepEqual(successFeedback([{ status: "APPLIED" }, { status: "SKIPPED" }]), { severity: "warn", key: "feedback.partial" });
  assert.equal(successFeedback({ failed: [] }).severity, "success");
});
