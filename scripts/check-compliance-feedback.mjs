// Real application routes with isolated API fixtures: no external calls or business writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = 5192,
  base = `http://127.0.0.1:${port}`;
const output = new URL("../output/feedback-trail-fix/", import.meta.url);
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [
    root + "/node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: root + "/apps/web", stdio: "ignore" },
);
const errors = [],
  results = [];
let browser;
try {
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(base)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (server.exitCode !== null || i === 79) throw Error("Preview did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true });
  for (const lang of ["ar", "en"])
    for (const style of ["original", "balance", "canvas", "precision"])
      for (const mode of ["light", "dark"]) {
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
        await context.addInitScript(
          ({ lang, style, mode }) => {
            localStorage.setItem(
              "erp-auth",
              JSON.stringify({
                state: { accessToken: "fixture", refreshToken: "fixture" },
                version: 0,
              }),
            );
            localStorage.setItem("erp-lang", lang);
            localStorage.setItem(
              "erp-theme",
              JSON.stringify({
                state: {
                  theme:
                    style === "original"
                      ? mode === "dark"
                        ? "night"
                        : "forest"
                      : style + (mode === "dark" ? "dark" : ""),
                  direction: style,
                  mode,
                  lastLight: "forest",
                  lastDark: "night",
                },
                version: 3,
              }),
            );
          },
          { lang, style, mode },
        );
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        let acceptance,
          warning,
          issue = "CERTIFICATE_KEY_MISMATCH",
          queued = 0;
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url()),
            path = url.pathname.replace(/^\/api/, "");
          let data;
          if (req.method() === "POST" && path === "/v1/compliance/invoices/invoice-1/resubmit") {
            if (issue)
              return route.fulfill({
                status: 409,
                json: {
                  error: {
                    code: "SUBMISSION_BLOCKED",
                    message: "Resolve the submission issue",
                    details: [],
                  },
                },
              });
            queued++;
            return route.fulfill({ status: 202, json: { status: "QUEUED" } });
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
              roles: [],
              permissions: ["sales_invoice:read", "compliance:read", "compliance:manage"],
            };
          else if (path === "/v1/company/logo") return route.fulfill({ status: 404, json: {} });
          else if (path === "/v1/purchasing/pending-counts") data = {};
          else if (path === "/v1/sales-invoices/invoice-1")
            data = {
              id: "invoice-1",
              number: "INV-0001",
              documentType: "INVOICE",
              customerId: "customer-1",
              customerName: "Sample",
              invoiceDate: "2026-11-15",
              currency: "SAR",
              totalNet: "100.0000",
              totalTax: "15.0000",
              totalGross: "115.0000",
              settlementStatus: "OPEN",
              outstandingAmount: "115.0000",
              lines: [],
              notes: null,
              stockCostStatus: "FINAL",
            };
          else if (path === "/v1/document-trail/sales_invoice/invoice-1")
            data = {
              nodes: [
                {
                  kind: "sales_invoice",
                  id: "invoice-1",
                  number: "INV-0001",
                  status: "INVOICE",
                  date: "2026-11-15",
                  createdAt: "2026-11-15T00:00:00Z",
                },
              ],
              edges: [],
              truncated: false,
            };
          else if (path === "/v1/compliance/overview")
            data = {
              environment: "sandbox",
              allowedEnvironments: ["sandbox", "simulation"],
              seller: {},
              egsUnits: [],
              capabilities: { resubmit: true },
            };
          else if (path === "/v1/compliance/invoices/invoice-1") {
            if (!acceptance) return route.fulfill({ status: 404, json: {} });
            data = { invoiceNumber: "INV-0001", egsName: "Sandbox", salesInvoiceId: "invoice-1", status: "ACCEPTED_WITH_WARNINGS", authorityStatus: acceptance, environment: "sandbox", uuid: "invoice-1", icv: "1", attempts: 1, warnings: ["BR-KSA-15: Delivery date required"], errors: [], history: [], canResubmit: false, submittedAt: null, clearedAt: null, reportedAt: null };
          }
          else if (path === "/v1/compliance/invoices/statuses")
            data = { "invoice-1": { status: "NOT_SUBMITTED", environment: "sandbox" } };
          else if (path === "/v1/compliance/invoices/invoice-1/submission-readiness")
            data = {
              canSubmit: !issue,
              issue,
              warning,
              blockingInvoice: issue ? { id: "invoice-previous", number: "INV-0000" } : null,
            };
          else if (path === "/v1/tax-codes" || path === "/v1/warehouses") data = [];
          else {
            errors.push("Unexpected read " + path);
            return route.fulfill({ status: 404, json: {} });
          }
          return route.fulfill({ json: data });
        });
        await page.goto(base + "/sales/invoices/invoice-1", { waitUntil: "networkidle" });
        const retry = page.getByRole("button", {
          name: copy.compliance.invoicePanel.resubmit,
          exact: true,
        });
        await page
          .getByText(copy.compliance.submissionIssue.CERTIFICATE_KEY_MISMATCH, { exact: true })
          .waitFor();
        assert(await retry.isDisabled());
        assert.equal(queued, 0);
        assert.equal(
          await page.locator('a[href="/sales/invoices/invoice-previous"]').textContent(),
          "INV-0000",
        );
        assert.equal(await page.locator(".p-toast-message-success").count(), 0);
        issue = null;
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(
          () => document.querySelectorAll(".compliance-test-notice").length === 1,
        );
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
          await retry.click();
          const toast = page.locator(".p-toast-message-info");
          await toast.waitFor();
          assert.equal(await page.locator(".p-toast-message-success").count(), 0);
          assert(
            await toast.getByText(copy.compliance.invoicePanel.queued, { exact: true }).isVisible(),
          );
          const bounds = await toast.boundingBox();
          assert(
            bounds.width <= 390 && bounds.x >= 0 && bounds.x + bounds.width <= width,
            JSON.stringify({ lang, style, mode, width, bounds }),
          );
          assert(bounds.height < 300, "Toast stays compact");
          assert.equal(
            await page.locator("html").getAttribute("dir"),
            lang === "ar" ? "rtl" : "ltr",
          );
          if (style === "balance" && mode === "light")
            await page.screenshot({
              path: fileURLToPath(new URL(`${lang}-${width}-queued.png`, output)),
            });
          results.push({ lang, style, mode, width, toast: bounds });
          await page.locator(".p-toast-icon-close").click();
          await toast.waitFor({ state: "hidden" });
        }
        issue = "CHAIN_BLOCKED";
        await retry.click();
        await page
          .getByText(copy.compliance.submissionIssue.CHAIN_BLOCKED, { exact: true })
          .waitFor();
        assert(await retry.isDisabled(), "A late server rejection refreshes readiness");
        assert.equal(await page.locator(".p-toast-message-success").count(), 0);
        assert.equal(queued, 2);
        warning = "CERTIFICATE_SELLER_MISMATCH";
        issue = null;
        await page.reload({ waitUntil: "networkidle" });
        await page
          .getByText(copy.compliance.invoicePanel.sandboxSubmissionWarning, { exact: true })
          .waitFor();
        assert(
          await retry.isEnabled(),
          "Sandbox test generation remains available with a provider warning",
        );
        await retry.click();
        await page.locator(".p-toast-message-info").waitFor();
        assert.equal(queued, 3);
        assert.equal(await page.locator(".p-toast-message-success").count(), 0);
        warning = undefined;
        for (acceptance of ["CLEARED", "REPORTED"]) {
          await page.reload({ waitUntil: "networkidle" });
          await page.getByText(`(${acceptance})`, { exact: true }).waitFor();
          assert(await page.getByText(copy.compliance.invoiceStatus.ACCEPTED_WITH_WARNINGS, { exact: true }).isVisible());
          assert(await page.getByText("BR-KSA-15: Delivery date required", { exact: true }).isVisible());
          assert.equal(await retry.count(), 0);
          if (acceptance === "CLEARED" && style === "balance" && mode === "light") await page.screenshot({ path: fileURLToPath(new URL(`${lang}-accepted-with-warnings.png`, output)) });
        }
        await context.close();
      }
  assert.deepEqual(errors, []);
  await writeFile(new URL("browser-results.json", output), JSON.stringify(results, null, 2));
  console.log(
    `Passed ${results.length} toast cases, 16 blocked/queued invoice flows and 32 authority-acceptance views (Arabic/English, all styles, light/dark, desktop/mobile).`,
  );
} finally {
  await browser?.close();
  server.kill();
}
