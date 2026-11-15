// Actual application routes with deterministic API fixtures. No live backend or writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5188";
const output = new URL("../output/interface-theme-qa/", import.meta.url);
await mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  [root + "/node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "5188"],
  { cwd: root + "/apps/web", stdio: "ignore" },
);
const statuses = ["OPEN", "PARTIAL", "SETTLED", "OVERDUE", "RECORDED"];
const invoices = Array.from({ length: 35 }, (_, i) => ({
  id: `invoice-${i + 1}`,
  number: `INV-${String(i + 1).padStart(4, "0")}`,
  documentType: i % 5 === 4 ? "CREDIT_NOTE" : "INVOICE",
  customerId: "customer-1",
  customerName: i === 0 ? "=FORMULA()" : "Sample customer",
  customerNameAr: "عميل تجريبي",
  invoiceDate: "2026-11-14",
  dueDate: "2026-11-15",
  currency: "SAR",
  totalNet: "100.0000",
  totalTax: "15.0000",
  totalGross: "115.0000",
  originalInvoiceId: null,
  settlementStatus: statuses[i % 5],
  outstandingAmount: i % 5 === 4 ? null : i % 5 === 2 ? "0.0000" : "115.0000",
}));
const pageOf = (data) => ({ data, pageInfo: { hasMore: false, nextCursor: null } });
const errors = [];
let browser;
let cases = 0;
try {
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(base)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    if (i === 79) throw Error("Application preview did not start");
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
    for (const style of ["balance", "canvas", "precision"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await context.addInitScript(
        ({ lang, style }) => {
          localStorage.setItem(
            "erp-auth",
            JSON.stringify({
              state: { accessToken: "local-fixture", refreshToken: "local-fixture" },
              version: 0,
            }),
          );
          localStorage.setItem("erp-lang", lang);
          localStorage.setItem(
            "erp-theme",
            JSON.stringify({
              state: { theme: style, direction: style, lastLight: style, lastDark: style + "dark" },
              version: 3,
            }),
          );
        },
        { lang, style },
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      let auditAllowed = true;
      let auditReads = 0;
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          path = url.pathname.replace(/^\/api/, "");
        if (req.method() !== "GET") {
          errors.push("Unexpected mutation " + path);
          return route.abort();
        }
        let data;
        if (path === "/v1/users/me")
          data = {
            id: "reviewer",
            email: "reviewer@example.test",
            companyId: "sample",
            companyName: "Sample company",
            companyNameAr: "شركة تجريبية",
            companyDefaultCurrency: "SAR",
            ref: "QA",
            roles: [],
            permissions: [
              "sales_invoice:read",
              "payment:read",
              ...(auditAllowed ? ["audit_log:read"] : []),
            ],
          };
        else if (path === "/v1/company/logo") return route.fulfill({ status: 404, json: {} });
        else if (path === "/v1/purchasing/pending-counts") data = {};
        else if (path === "/v1/sales-invoices")
          data = pageOf(
            invoices.filter(
              (row) =>
                !url.searchParams.has("documentType") ||
                row.documentType === url.searchParams.get("documentType"),
            ),
          );
        else if (path.startsWith("/v1/sales-invoices/"))
          data = {
            ...invoices.find((row) => path.endsWith("/" + row.id)),
            lines: [],
            notes: null,
            stockCostStatus: "FINAL",
          };
        else if (path === "/v1/payments/receipt-1")
          data = {
            id: "receipt-1",
            number: "RCT-0001",
            direction: "RECEIPT",
            partyId: "customer-1",
            counterpartyKind: "CUSTOMER",
            partyName: "Sample customer",
            partyNameAr: "عميل تجريبي",
            paymentDate: "2026-11-15",
            amount: "115.0000",
            allocated: "115.0000",
            unallocated: "0.0000",
            currency: "SAR",
            method: "CASH",
            reference: null,
            notes: null,
            journalEntryId: "journal-1",
            voidedAt: null,
            reversesPaymentId: null,
            reversedByPaymentId: null,
            cashAccountCode: "1000",
            cashAccountName: "Cash",
            cashAccountNameAr: "الصندوق",
            allocations: [
              {
                invoiceId: "invoice-1",
                invoiceNumber: "INV-0001",
                invoiceKind: "SALES",
                amount: "115.0000",
              },
            ],
          };
        else if (path.startsWith("/v1/document-trail/"))
          data = {
            nodes: [
              {
                kind: "sales_invoice",
                id: "invoice-1",
                number: "INV-0001",
                status: "INVOICE",
                date: "2026-11-14",
                createdAt: "2026-11-14T10:00:00Z",
              },
              {
                kind: "payment",
                id: "receipt-1",
                number: "RCT-0001",
                status: "POSTED",
                date: "2026-11-15",
                createdAt: "2026-11-15T10:00:00Z",
              },
            ],
            edges: [{ from: "sales_invoice:invoice-1", to: "payment:receipt-1" }],
            truncated: false,
          };
        else if (path === "/v1/audit-log") {
          auditReads++;
          assert(auditAllowed, "Audit requested without permission");
          const entity = url.searchParams.get("entityType"),
            id = url.searchParams.get("entityId");
          assert(["SalesInvoice", "Payment"].includes(entity));
          assert(["invoice-1", "receipt-1"].includes(id));
          data = pageOf([
            {
              id: "event-1",
              createdAt: "2026-11-15T10:00:00Z",
              actorId: "reviewer",
              actorEmail: "reviewer@example.test",
              action: entity === "Payment" ? "customer_receipt.posted" : "sales_invoice.posted",
              entityType: entity,
              entityId: id,
              before: null,
              after: {
                number: entity === "Payment" ? "RCT-0001" : "INV-0001",
                totalGross: "115.0000",
              },
              correlationId: "sample",
              document: null,
              relatedDocuments: [],
            },
          ]);
        } else if (path === "/v1/tax-codes" || path === "/v1/warehouses") data = [];
        else {
          errors.push("Unexpected read " + path);
          return route.fulfill({ status: 404, json: {} });
        }
        return route.fulfill({ json: data });
      });
      await page.goto(base + "/sales/invoices", { waitUntil: "networkidle" });
      assert.equal(
        await page.locator(".mk-module-nav").count(),
        0,
        "Precision secondary navigation removed",
      );
      assert(
        await page
          .getByRole("columnheader", { name: copy.sales.invoices.settlement, exact: true })
          .isVisible(),
      );
      const rowSelect = page.locator("tbody input[type=checkbox]");
      await rowSelect.first().check();
      assert.equal(new URL(page.url()).pathname, "/sales/invoices", "Selection does not navigate");
      await rowSelect.nth(1).check();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: copy.table.exportSelected, exact: true }).click();
      const download = await downloadPromise;
      const csv = await readFile(await download.path(), "utf8");
      assert.equal(csv.split("\r\n").length, 3, "Export contains exactly the selected records");
      assert(csv.includes("INV-0001") && csv.includes("INV-0002") && !csv.includes("INV-0003"));
      if (lang === "en") assert(csv.includes("'=FORMULA()"), "CSV formula escaped");
      await page.getByRole("button", { name: copy.table.clearSelection, exact: true }).click();
      await page.locator("thead input[type=checkbox]").check();
      assert.equal(await page.locator("tbody input[type=checkbox]:checked").count(), 25);
      await page.locator(".p-paginator-next").click();
      assert.equal(
        await page.locator("tbody input[type=checkbox]:checked").count(),
        0,
        "Select-page does not select unseen pages",
      );
      await page.getByRole("button", { name: copy.table.clearSelection, exact: true }).click();
      await page.locator(".mk-status-tabs button").nth(3).click();
      assert.equal(await page.locator("tbody tr").count(), 7, "Settled tab filters real statuses");
      await page.locator(".mk-status-tabs button").first().click();
      await page.getByRole("textbox", { name: copy.table.search, exact: true }).fill("INV-0001");
      await page.locator("thead input[type=checkbox]").check();
      assert.equal(
        await page.locator("tbody input[type=checkbox]:checked").count(),
        1,
        "Select-page respects search",
      );
      await page.getByRole("textbox", { name: copy.table.search, exact: true }).fill("");
      assert.equal(
        await page.locator("tbody input[type=checkbox]:checked").count(),
        0,
        "Search resets selection",
      );
      for (const mode of ["light", "dark"]) {
        if (mode === "dark") await page.locator(".erp-topbar__theme").click();
        for (const path of ["/sales/invoices/invoice-1", "/payments/receipt-1"]) {
          // SPA navigation keeps the mode preference; init scripts only establish the context on first load.
          if (path.includes("sales")) await page.locator('tbody a[href="/sales/invoices/invoice-1"]').click();
          else
            await page.locator('.mk-document-flow a[href="/payments/receipt-1"]').first().click();
          await page.waitForURL(base + path);
          await page.getByRole("heading", { level: 1, name: path.includes("sales") ? "INV-0001" : "RCT-0001", exact: true }).waitFor();
          await page.locator(".mk-document-flow__current").waitFor();
          assert.equal(new URL(page.url()).pathname, path);
          assert.equal(await page.locator(".mk-document-flow > li").count(), 2);
          assert.equal(await page.locator(".mk-document-flow__current").count(), 1);
          await page.getByRole("tab", { name: copy.trail.activity, exact: true }).click();
          await page.locator(".mk-event-timeline > li").waitFor();
          await page
            .locator(".mk-document-activity")
            .getByRole("button", { name: copy.audit.details, exact: true })
            .click();
          await page.getByRole("dialog").waitFor();
          assert(await page.getByRole("dialog").getByText("115.0000", { exact: true }).isVisible());
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.getByRole("tab", { name: copy.trail.relatedDocuments, exact: true }).click();
        }
        await page.locator(".mk-document-history").screenshot({
          path: fileURLToPath(new URL(`${lang}-${style}-${mode}-history.png`, output)),
        });
        // Return via the existing invoice link and its page back action.
        await page.locator('.mk-document-flow a[href="/sales/invoices/invoice-1"]').first().click();
        await page.waitForURL(base + "/sales/invoices/invoice-1");
        await page.getByRole("button", { name: copy.sales.invoices.downloadPdf, exact: true }).waitFor();
        await page.getByRole("button", { name: copy.sales.orders.back, exact: true }).click();
        await page.waitForURL(base + "/sales/invoices");
        await page.locator(".mk-status-tabs").waitFor();
        cases++;
        console.log(`PASS document routes ${lang}/${style}/${mode}`);
      }
      // Removing the audit permission must remove the activity entry point and its network read.
      auditAllowed = false;
      const previousReads = auditReads;
      await page.goto(base + "/sales/invoices/invoice-1", { waitUntil: "networkidle" });
      assert.equal(
        await page.getByRole("tab", { name: copy.trail.activity, exact: true }).count(),
        0,
      );
      assert.equal(auditReads, previousReads);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("documents.json", output),
    JSON.stringify({ cases, errors, writes: 0 }, null, 2),
  );
  console.log(
    `PASS ${cases} real-route style/language/mode checks: invoice statuses, page selection, filtered CSV, linked invoice/voucher history, audit details, permissions and mobile width`,
  );
} catch (error) {
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page.screenshot({
      path: fileURLToPath(new URL("document-failure.png", output)),
      fullPage: true,
    });
    console.error(
      await page.evaluate(() => ({
        path: location.pathname,
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        errorText: document.querySelector('[role="alert"]')?.textContent,
      })),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
