// Real form rendering with isolated API fixtures; no business network calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url)),
  base = "http://127.0.0.1:5193";
const out = new URL("../output/feedback-trail-fix/", import.meta.url);
await mkdir(out, { recursive: true });
const server = spawn(
  process.execPath,
  [root + "/node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "5193"],
  { cwd: root + "/apps/web", stdio: "ignore" },
);
let browser;
const errors = [];
try {
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(base)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (i === 79) throw Error("Preview unavailable");
    await new Promise((r) => setTimeout(r, 250));
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
      timezoneId: "Asia/Riyadh",
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      ({ lang, token }) => {
        localStorage.setItem(
          "erp-auth",
          JSON.stringify({ state: { accessToken: token, refreshToken: "fixture" }, version: 0 }),
        );
        localStorage.setItem("erp-lang", lang);
        localStorage.setItem(
          "erp-theme",
          JSON.stringify({
            state: {
              theme: "balance",
              direction: "balance",
              mode: "light",
              lastLight: "forest",
              lastDark: "night",
            },
            version: 3,
          }),
        );
      },
      {
        lang,
        token: "x." + Buffer.from(JSON.stringify({ sub: "qa" })).toString("base64url") + ".x",
      },
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    let draft,
      attempts = 0,
      body;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname.replace(/^\/api/, "");
      let data;
      if (req.method() === "PUT" && path.startsWith("/v1/document-drafts/")) {
        draft = req.postDataJSON();
        return route.fulfill({ json: { id: path.split("/").at(-1), version: 1, ...draft } });
      }
      if (req.method() === "POST" && path === "/v1/sales-invoices") {
        body = req.postDataJSON();
        attempts++;
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code:
                attempts === 1 ? "COMPLIANCE_SUPPLY_DATE_REQUIRED" : "COMPLIANCE_BUYER_VAT_INVALID",
              message: "Correct data",
              details: [],
            },
          },
        });
      }
      if (req.method() !== "GET") {
        errors.push("Unexpected mutation " + path);
        return route.abort();
      }
      if (path === "/v1/users/me")
        data = {
          id: "qa",
          companyId: "qa",
          email: "qa@example.test",
          companyName: "Sample",
          companyDefaultCurrency: "SAR",
          roles: [],
          permissions: [
            "sales_invoice:read",
            "sales_invoice:create",
            "compliance:read",
            "party:read",
            "item:read",
            "warehouse:read",
            "stock_level:read",
            "tax_code:read",
            "document_draft:read",
            "document_draft:write",
          ],
        };
      else if (path === "/v1/company/logo") return route.fulfill({ status: 404, json: {} });
      else if (path === "/v1/purchasing/pending-counts") data = {};
      else if (path === "/v1/compliance/overview")
        data = {
          environment: "sandbox",
          allowedEnvironments: ["sandbox"],
          seller: {},
          egsUnits: [
            {
              id: "egs",
              name: "Sandbox",
              isActive: true,
              status: "ACTIVE",
              environment: "sandbox",
            },
          ],
          capabilities: { resubmit: true },
        };
      else if (path === "/v1/parties")
        data = {
          data: [
            {
              id: "buyer",
              name: "Test buyer",
              nameAr: "عميل اختبار",
              kind: "CUSTOMER",
              vatNumber: "123456789012345",
            },
          ],
          pageInfo: { hasMore: false, nextCursor: null },
        };
      else if (path === "/v1/items" || path === "/v1/warehouses" || path === "/v1/document-drafts")
        data = { data: [], pageInfo: { hasMore: false, nextCursor: null } };
      else if (path === "/v1/stock-levels") data = [];
      else if (path === "/v1/tax-codes")
        data = [
          {
            id: "vat",
            code: "VAT15",
            name: "VAT 15%",
            rate: "15",
            treatment: "STANDARD",
            isActive: true,
          },
        ];
      else {
        errors.push("Unexpected read " + path);
        return route.fulfill({ status: 404, json: {} });
      }
      return route.fulfill({ json: data });
    });
    await page.goto(base + "/sales/invoices/new", { waitUntil: "networkidle" });
    const supply = page.locator("#sdSupplyDate");
    await supply.waitFor();
    assert.equal(await supply.inputValue(), "", "Supply date is never inferred");
    await page
      .locator(".p-dropdown")
      .filter({ has: page.locator("#sdCustomer") })
      .click();
    await page
      .getByRole("option")
      .filter({ hasText: lang === "ar" ? "عميل اختبار" : "Test buyer" })
      .click();
    await page
      .getByPlaceholder(copy.sales.description, { exact: true })
      .fill("Supply-date verification");
    await page.getByPlaceholder(copy.purchasing.unitPrice, { exact: true }).fill("100");
    await page.getByRole("button", { name: copy.sales.invoices.submit, exact: true }).click();
    await page
      .getByText(copy.compliance.issueErrors.COMPLIANCE_SUPPLY_DATE_REQUIRED, { exact: true })
      .waitFor();
    assert.equal(body.actualDeliveryDate, undefined);
    await supply.fill("2026-11-15");
    await supply.press("Tab");
    await page.getByRole("button", { name: copy.sales.invoices.submit, exact: true }).click();
    await page
      .getByText(copy.compliance.issueErrors.COMPLIANCE_BUYER_VAT_INVALID, { exact: true })
      .waitFor();
    assert.equal(body.actualDeliveryDate, "2026-11-15");
    assert.equal(draft.payload.actualDeliveryDate, "2026-11-14T21:00:00.000Z");
    await page.screenshot({
      path: fileURLToPath(new URL(`${lang}-invoice-preflight-desktop.png`, out)),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // CI runs this right after a full monorepo build on a shared, loaded runner; a one-shot
    // assert right after the resize flaked there even though layout settles well under this
    // locally (same race check-interface-styles.mjs already guards against). The assertion
    // itself stays exactly as strict — this only gives the reflow time to actually finish.
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, null, { timeout: 15000 });
    await supply.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: fileURLToPath(new URL(`${lang}-invoice-preflight-mobile.png`, out)),
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Passed AR/EN supply-date entry, draft persistence, actionable pre-issue errors and mobile layout.",
  );
} finally {
  await browser?.close();
  server.kill();
}
