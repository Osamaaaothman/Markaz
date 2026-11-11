import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionRefresher } from "./refresh-session.ts";

test("two tabs serialize rotation and reuse the token produced by the first", async () => {
  let persisted = "old";
  let calls = 0;
  let tail = Promise.resolve();
  const lock = (work) => {
    const next = tail.then(work);
    tail = next.then(() => {});
    return next;
  };
  const tab = () => {
    let local = "old";
    return createSessionRefresher({
      lock,
      synchronize: async () => {
        local = persisted;
      },
      accessToken: () => local,
      sameUser: () => true,
      refresh: async () => {
        calls++;
        persisted = local = "rotated";
        return local;
      },
    });
  };
  const first = tab(),
    second = tab();
  const results = await Promise.all([first("old"), second("old"), first("old")]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((r) => r.token),
    ["rotated", "rotated", "rotated"],
  );
});

test("logout and another user login never replay a stale request or clear the new login", async () => {
  for (const current of [null, "different-user"]) {
    let calls = 0;
    const refresh = createSessionRefresher({
      synchronize: async () => {},
      accessToken: () => current,
      sameUser: () => false,
      lock: (work) => work(),
      refresh: async () => {
        calls++;
        return "bad";
      },
    });
    assert.deepEqual(await refresh("old"), { token: null, clear: false });
    assert.equal(calls, 0);
  }
});

test("a rejected current refresh clears the expired session", async () => {
  const refresh = createSessionRefresher({
    synchronize: async () => {},
    accessToken: () => "old",
    sameUser: () => true,
    lock: (work) => work(),
    refresh: async () => null,
  });
  assert.deepEqual(await refresh("old"), { token: null, clear: true });
});
