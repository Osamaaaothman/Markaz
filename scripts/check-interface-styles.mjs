// Browser regression for the real application stylesheet and shared components.
// Uses the isolated appearance entry: no credentials, backend or business writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = 5187;
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "apps/web/vite.redesign.config.ts",
    "--port",
    String(port),
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (data) => {
  serverLog += data;
});
server.stderr.on("data", (data) => {
  serverLog += data;
});
const output = new URL("../output/interface-theme-qa/", import.meta.url);
await mkdir(output, { recursive: true });
let browser;
const results = [];
const errors = [];
let paletteChecks = 0;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw Error(`Preview exited: ${serverLog}`);
    if (
      await fetch(`${base}/appearance.html`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    if (attempt === 79) throw Error(`Preview did not start: ${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
  for (const lang of ["ar", "en"]) {
    const copy = JSON.parse(
      await readFile(
        new URL(`../apps/web/src/locales/${lang}/common.json`, import.meta.url),
        "utf8",
      ),
    );
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.addInitScript((language) => localStorage.setItem("erp-lang", language), lang);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/api/")) errors.push(`Unexpected API call: ${request.url()}`);
    });
    await page.goto(`${base}/appearance.html`, { waitUntil: "networkidle" });
    await page.locator("#gallery-notes").fill("Preserved across styles");
    for (const style of ["balance", "canvas", "precision"]) {
      await page.locator(`input[name="design-direction"][value="${style}"]`).check();
      for (const mode of ["light", "dark"]) {
        if ((await page.locator("html").getAttribute("data-theme-mode")) !== mode)
          await page.locator(".erp-topbar__theme").click();
        await page.waitForFunction(() =>
          Boolean(document.querySelector("#prime-theme-link")?.sheet),
        );
        const metrics = await page.evaluate(() => {
          const css = (selector) => getComputedStyle(document.querySelector(selector));
          const table = css('[data-testid="gallery-grid"] tbody td');
          const tree = css(".p-treetable tbody td");
          return {
            direction: document.documentElement.dir,
            style: document.documentElement.dataset.design,
            mode: document.documentElement.dataset.themeMode,
            rowPadding: parseFloat(table.paddingBlockStart),
            treePadding: parseFloat(tree.paddingBlockStart),
            rule: parseFloat(table.borderInlineEndWidth),
            space: css('[data-testid="gallery-grid"] table').borderSpacing,
            button: css('[data-testid="gallery-actions"] .p-button').borderRadius,
            segment: css(".p-selectbutton .p-button").borderRadius,
            input: css("#dsText").borderRadius,
            notes: document.querySelector("#gallery-notes").value,
            documentWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
          };
        });
        assert.equal(metrics.direction, lang === "ar" ? "rtl" : "ltr");
        assert.equal(metrics.style, style);
        assert.equal(metrics.mode, mode);
        assert.equal(metrics.notes, "Preserved across styles");
        assert.equal(metrics.button, { balance: "6px", canvas: "999px", precision: "2px" }[style]);
        assert.equal(metrics.segment, metrics.button, "Segmented controls must follow the design");
        assert.equal(metrics.input, { balance: "6px", canvas: "12px", precision: "2px" }[style]);
        assert(
          Math.abs(metrics.rowPadding - { balance: 11.2, canvas: 13.6, precision: 8 }[style]) < 0.2,
          "Small/gridlined tables must not retain Lara padding",
        );
        assert.equal(metrics.treePadding, metrics.rowPadding);
        assert.equal(metrics.rule > 0, style === "precision");
        assert.equal(metrics.space.includes("6px"), style === "canvas");
        assert(metrics.documentWidth <= metrics.viewport + 2, "Desktop overflow");
        const evenCell = page
          .locator('[data-testid="gallery-grid"] tbody tr')
          .nth(1)
          .locator("td")
          .first();
        await page.mouse.move(0, 0);
        const idleBackground = await evenCell.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        await evenCell.hover();
        await page.waitForFunction(
          (idle) =>
            getComputedStyle(
              document.querySelector('[data-testid="gallery-grid"] tbody tr:nth-child(2) td'),
            ).backgroundColor !== idle,
          idleBackground,
        );
        await page.mouse.move(0, 0);
        await page.getByRole("button", { name: copy.ds.gallery.created, exact: true }).click();
        const dialog = page.getByRole("dialog");
        assert.equal(
          await dialog.evaluate((element) => getComputedStyle(element).borderRadius),
          { balance: "8px", canvas: "18px", precision: "2px" }[style],
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: copy.ds.gallery.popover, exact: true }).click();
        assert.equal(
          await page
            .locator(".p-overlaypanel")
            .evaluate((element) => getComputedStyle(element).borderRadius),
          { balance: "8px", canvas: "16px", precision: "2px" }[style],
        );
        await page.keyboard.press("Escape");
        await page.locator(".p-overlaypanel").waitFor({ state: "hidden" });
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, null, {
            timeout: 5000,
          })
          .catch(async (error) => {
            console.error(
              lang,
              style,
              mode,
              await page.evaluate(() => ({
                width: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                elements: [...document.querySelectorAll("body *")]
                  .filter((element) => {
                    const rect = element.getBoundingClientRect();
                    return (
                      rect.width > 0 &&
                      (rect.right > innerWidth + 2 || rect.left < -2) &&
                      !element.closest(".p-datatable-wrapper, .p-treetable-wrapper")
                    );
                  })
                  .map((element) => ({
                    tag: element.tagName,
                    className: element.className,
                    width: element.getBoundingClientRect().width,
                    text: element.textContent.slice(0, 60),
                  }))
                  .slice(0, 20),
              })),
            );
            await page.screenshot({
              path: fileURLToPath(new URL("mobile-overflow.png", output)),
              fullPage: true,
            });
            throw error;
          });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
          `${lang}/${style}/${mode}: mobile overflow`,
        );
        await page.getByRole("button", { name: copy.ds.gallery.toast, exact: true }).click();
        await page.locator(".p-toast-message").waitFor();
        assert(
          await page.locator(".p-toast-message").evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
          }),
          "Mobile toast fits the viewport",
        );
        await page.locator(".p-toast-icon-close").click();
        await page.locator(".p-toast-message").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: copy.ds.gallery.created, exact: true }).click();
        assert(
          await dialog.evaluate((element) => element.getBoundingClientRect().width <= innerWidth),
          "Mobile dialog fits",
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('[data-testid="gallery-grid"]').screenshot({
          path: fileURLToPath(new URL(`${lang}-${style}-${mode}-grid.png`, output)),
        });
        results.push({ lang, ...metrics });
      }
    }
    const grid = page.getByTestId("gallery-grid");
    await grid.getByRole("textbox", { name: copy.table.search, exact: true }).fill("INV-0012");
    assert.equal(await grid.locator("tbody tr").count(), 1, "Search still works");
    assert.match(await grid.locator("tbody").innerText(), /INV-0012/);
    await grid.getByRole("textbox", { name: copy.table.search, exact: true }).fill("");
    await grid.locator(".p-paginator-next").click();
    assert.match(await grid.locator("tbody").innerText(), /INV-0011/);
    await grid.locator(".p-paginator-first").click();
    await grid.locator(".p-column-filter-menu-button").click();
    await page.locator(".p-column-filter-overlay input").fill("INV-0002");
    await page.locator(".p-column-filter-buttonbar .p-button").last().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="gallery-grid"] tbody tr').length === 1,
    );
    assert.equal(await grid.locator("tbody tr").count(), 1, "Column filter works");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.locator("html").getAttribute("data-design"),
      "precision",
      "Direction persists after reload",
    );
    assert.equal(
      await page.locator("html").getAttribute("data-theme-mode"),
      "dark",
      "Mode persists after reload",
    );
    // Every palette remains usable with every geometry. The real settings cards
    // drive this check, so a new palette is automatically included in the gate.
    const paletteCards = page.locator(".mk-theme-card");
    for (const style of ["balance", "canvas", "precision"]) {
      await page.locator(`input[name="design-direction"][value="${style}"]`).check();
      for (let index = 0; index < (await paletteCards.count()); index++) {
        await paletteCards.nth(index).click();
        assert.equal(await page.locator("html").getAttribute("data-design"), style);
        assert.equal(await paletteCards.nth(index).getAttribute("aria-checked"), "true");
        const palette = await page.locator("html").getAttribute("data-theme");
        await page
          .locator(
            `input[name="design-direction"][value="${style === "canvas" ? "balance" : "canvas"}"]`,
          )
          .check();
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          palette,
          "Style preserves chosen palette",
        );
        await page.locator(`input[name="design-direction"][value="${style}"]`).check();
        paletteChecks++;
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("result.json", output),
    JSON.stringify({ combinations: results.length, paletteChecks, results, errors }, null, 2),
  );
  console.log(
    `PASS ${results.length} RTL/LTR, light/dark and style combinations; table/button/portal geometry, field preservation, mobile layouts, search, pagination, filters and persistence`,
  );
} finally {
  await browser?.close();
  server.kill();
}
