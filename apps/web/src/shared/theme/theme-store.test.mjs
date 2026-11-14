import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
const { useThemeStore: store, THEMES } = await import("./theme-store.ts");

test("all palettes keep the independently selected geometry and survive reload", async () => {
  for (const direction of ["balance", "canvas", "precision", "original"]) {
    store.getState().setDirection(direction);
    for (const { id, mode } of THEMES) {
      store.getState().setTheme(id);
      assert.equal(store.getState().direction, direction);
      assert.equal(store.getState().mode, mode);
      await store.persist.rehydrate();
      assert.equal(store.getState().theme, id);
      assert.equal(store.getState().direction, direction);
    }
  }
});

test("changing style keeps a custom colour choice in both modes", () => {
  for (const theme of ["ocean", "graphite"]) {
    store.getState().setTheme(theme);
    for (const direction of ["canvas", "balance", "precision", "original"]) {
      store.getState().setDirection(direction);
      assert.equal(store.getState().theme, theme);
    }
  }
});

test("original style colours remain explicitly available, with light/dark partners", () => {
  for (const direction of ["balance", "canvas", "precision"]) {
    store.getState().setTheme("ocean");
    store.getState().setDirection(direction);
    store.getState().useDirectionPalette();
    assert.equal(store.getState().theme, direction);
    store.getState().toggle();
    assert.equal(store.getState().theme, `${direction}dark`);
    assert.equal(store.getState().direction, direction);
    store.getState().setTheme("graphite");
    store.getState().useDirectionPalette();
    assert.equal(store.getState().theme, `${direction}dark`);
  }
});

test("a palette's mode toggle cannot switch to its namesake geometry", () => {
  store.getState().setDirection("canvas");
  store.getState().setTheme("precision");
  store.getState().toggle();
  assert.equal(store.getState().theme, "precisiondark");
  assert.equal(store.getState().direction, "canvas");
  store.getState().toggle();
  assert.equal(store.getState().theme, "precision");
  assert.equal(store.getState().direction, "canvas");
});

test("v2 migration preserves original appearances and infers previous design selections", async () => {
  for (const [theme, direction] of [
    ["ocean", "original"],
    ["canvasdark", "canvas"],
    ["balance", "balance"],
    ["precision", "precision"],
  ]) {
    values.set(
      "erp-theme",
      JSON.stringify({ version: 2, state: { theme, lastLight: "ocean", lastDark: "graphite" } }),
    );
    await store.persist.rehydrate();
    assert.equal(store.getState().theme, theme);
    assert.equal(store.getState().direction, direction);
    assert.equal(JSON.parse(values.get("erp-theme")).version, 3);
  }
});

test("v1 dark preference migrates without opting into a redesign", async () => {
  values.set("erp-theme", JSON.stringify({ version: 1, state: { mode: "dark" } }));
  await store.persist.rehydrate();
  assert.equal(store.getState().theme, "night");
  assert.equal(store.getState().direction, "original");
});

test("invalid saved choices cannot replace valid state or actions", async () => {
  store.getState().setDirection("canvas");
  store.getState().setTheme("ocean");
  values.set(
    "erp-theme",
    JSON.stringify({
      version: 3,
      state: {
        theme: "broken",
        direction: "unknown",
        lastLight: "night",
        lastDark: "forest",
        setTheme: "invalid",
      },
    }),
  );
  await store.persist.rehydrate();
  assert.equal(store.getState().direction, "canvas");
  assert.equal(store.getState().theme, "ocean");
  assert.equal(store.getState().lastLight, "ocean");
  assert.equal(store.getState().lastDark, "night");
  assert.equal(typeof store.getState().setTheme, "function");
});
