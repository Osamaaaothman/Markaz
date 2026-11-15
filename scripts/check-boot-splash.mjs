// Verify the production build under the deployed CSP, without backend writes.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const dist = new URL("../apps/web/dist/", import.meta.url);
const nginx = await readFile(new URL("../docker/web.nginx.conf.template", import.meta.url), "utf8");
const csp = nginx.match(/add_header Content-Security-Policy "([^"]+)"/)[1];
for (const file of await readdir(new URL("assets/", dist))) {
  if (file.endsWith(".css")) {
    assert.doesNotMatch(await readFile(new URL(`assets/${file}`, dist), "utf8"), /fonts\.(googleapis|gstatic)\.com/);
  }
}
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const file = path === "/login" ? "index.html" : path.slice(1);
  try {
    const data = await readFile(new URL(file, dist));
    const ext = file.split(".").at(-1);
    res.writeHead(200, {
      "Content-Security-Policy": csp,
      "Content-Type": ({ html: "text/html", js: "text/javascript", css: "text/css", woff2: "font/woff2", svg: "image/svg+xml" })[ext] || "application/octet-stream",
    });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(new URL("../output/boot-splash-qa/", import.meta.url), { recursive: true });
  for (const lang of ["ar", "en"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.addInitScript(lang => {
      localStorage.setItem("erp-lang", lang);
      localStorage.setItem("erp-auth", JSON.stringify({ state: { accessToken: "stale-session", refreshToken: null }, version: 0 }));
    }, lang);
    await page.route("**/api/**", () => {}); // A hanging profile must not block /login.
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route("**/assets/LoginPage-*.js", async route => { await hold; await route.continue(); });
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    assert(await page.locator(".mk-splash__progress").isVisible());
    assert(await page.locator(`.mk-splash__loading .mk-splash__${lang}`).isVisible());
    await page.screenshot({ path: new URL(`../output/boot-splash-qa/${lang}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1") });
    const start = Date.now();
    release();
    await page.locator("#markaz-splash").waitFor({ state: "detached", timeout: 4000 });
    assert(Date.now() - start < 4000, "No mandatory five-second delay");
    assert(await page.locator('input[type="password"]').isVisible());
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${lang}: delayed route, pending old session, CSP and ready dismissal passed`);
  }
  const page = await browser.newPage();
  await page.clock.install();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route("**/assets/index-*.js", async route => { await hold; await route.continue(); });
  await page.goto(`${base}/login`, { waitUntil: "commit" });
  await page.locator("#markaz-splash").waitFor();
  await page.clock.fastForward(21000);
  assert(await page.locator("#markaz-splash-retry").isVisible());
  assert(!(await page.locator(".mk-splash__progress").isVisible()));
  release();
  await page.waitForTimeout(600);
  await page.clock.fastForward(1000);
  await page.locator("#markaz-splash").waitFor({ state: "detached" });
  console.log("Stalled startup recovery and late readiness passed; all CSS fonts are same-origin");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
