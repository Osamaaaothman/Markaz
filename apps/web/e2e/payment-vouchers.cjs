// Run against a local Vite preview: node apps/web/e2e/payment-vouchers.cjs
// UI contract fixtures only. Real posting/tenant tests live in voucher-types.integration.spec.ts.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const base = process.env.PAYMENT_PREVIEW_URL || "http://127.0.0.1:5179";
const permissions = ["account:read", "party:read", "payment:read", "payment:create", "customer_receipt:create", "supplier_payment:create", "document_draft:read", "document_draft:create"];
const token = `test.${Buffer.from(JSON.stringify({ sub: "test-user" })).toString("base64url")}.test`;
const parties = ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "CUSTOMER_SUPPLIER"].map((kind) => ({ id: kind, kind, name: kind, nameAr: kind }));
const account = (id, name, partyId = null) => ({ id, ref: id, code: id, name, nameAr: name, type: "ASSET", isActive: true, isPostable: true, parentId: null, partyId, party: null, color: null });
const bank = account("bank", "Test bank");
const cash = account("cash", "Test cash");
const employee = account("employee-account", "Employee account", "EMPLOYEE");
const other = account("other-account", "Other account");
const artifacts = path.resolve("output/payment-vouchers");

let activeList;
async function options(page, id) {
  await page.keyboard.press("Escape");
  await page.locator(".p-dropdown").filter({ has: page.locator(`#${id}`) }).click();
  activeList = page.locator(".p-dropdown-panel:visible").last().getByRole("listbox");
  await activeList.waitFor();
  return activeList.getByRole("option").allTextContents();
}
async function select(page, id, text) {
  await options(page, id);
  await activeList.getByRole("option").filter({ hasText: text }).first().click();
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const language of ["ar", "en"]) {
      for (const direction of ["RECEIPT", "PAYMENT"]) {
        const locale = require(`../src/locales/${language}/common.json`);
        const t = locale.payments;
        const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
        await context.addInitScript(({ token, language }) => {
          localStorage.setItem("erp-auth", JSON.stringify({ state: { accessToken: token, refreshToken: "fixture" }, version: 0 }));
          localStorage.setItem("erp-lang", language);
        }, { token, language });
        const page = await context.newPage();
        const errors = [], submissions = [], settlements = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("dialog", (dialog) => dialog.accept());
        await page.route("**/api/v1/**", async (route) => {
          const request = route.request(), url = new URL(request.url());
          const pathname = url.pathname.replace(/^\/api/, "");
          let body = {};
          if (pathname === "/v1/users/me") body = { id: "test-user", email: "test@example.invalid", ref: "TEST", companyId: "test-company", companyName: "Voucher QA", companyNameAr: "اختبار السندات", companyDefaultCurrency: "SAR", roles: [], permissions };
          else if (pathname === "/v1/chart-of-accounts") body = [bank, cash, employee, other];
          else if (pathname === "/v1/parties") body = { data: parties, pageInfo: { hasMore: false, nextCursor: null } };
          else if (pathname === "/v1/payments/cash-accounts") body = url.searchParams.get("method") === "CASH" ? [cash] : [bank];
          else if (pathname === "/v1/payments/open-invoices") body = [{ id: "invoice", number: "INV-1", invoiceDate: "2026-06-15", dueDate: null, currency: "SAR", gross: "100", outstanding: "100" }];
          else if (pathname === "/v1/payments/balance") body = { totalUnallocated: "100", unallocatedPayments: [], openInvoices: [{ id: "invoice", number: "INV-1", invoiceDate: "2026-06-15", dueDate: null, currency: "SAR", gross: "100", outstanding: "100" }] };
          else if (pathname === "/v1/payments/settle") { settlements.push(request.postDataJSON()); body = { totalAllocated: "12.59" }; }
          else if (pathname.startsWith("/v1/document-drafts/")) body = { id: pathname.split("/").pop(), version: 1 };
          else if (["/v1/customer-receipts", "/v1/supplier-payments"].includes(pathname)) {
            const payload = request.postDataJSON(); submissions.push(payload);
            body = { id: "posted", number: "TEST-1", unallocated: "0.0000" };
          } else if (pathname === "/v1/document-drafts") body = { data: [], pageInfo: { hasMore: false } };
          else if (pathname === "/v1/setup/status") body = { steps: [], requiredDone: true };
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        });
        const route = direction === "RECEIPT" ? "/payments/receipts/new" : "/payments/supplier/new";
        await page.goto(base + route);
        await page.locator("#payAmount").waitFor().catch(async (error) => {
          console.error({ url: page.url(), body: (await page.locator("body").innerText()).slice(0, 3000), errors });
          throw error;
        });
        const defaultKind = direction === "RECEIPT" ? "CUSTOMER" : "SUPPLIER";
        let names = await options(page, "payParty");
        assert.equal(names.length, 2);
        assert(names.every((name) => name.startsWith(defaultKind) || name.startsWith("CUSTOMER_SUPPLIER")));
        await activeList.getByRole("option").filter({ hasText: new RegExp(`^${defaultKind} ·`) }).click();
        await select(page, "payBank", "Test bank");
        for (const method of ["CASH", "CHEQUE", "CARD", "OTHER", "BANK_TRANSFER"]) {
          await select(page, "payMethod", t.methods[method]);
          const bankField = page.locator(".p-dropdown").filter({ has: page.locator("#payBank") });
          assert(!(await bankField.textContent()).includes("Test bank"));
          names = await options(page, "payBank");
          assert.deepEqual(names, [method === "CASH" ? "cash — Test cash" : "bank — Test bank"]);
          await activeList.getByRole("option").click();
        }
        const allocation = page.getByRole("textbox", { name: `${t.settleNow} INV-1`, exact: true });
        await allocation.fill("١٢٫٥");
        assert.equal(await allocation.inputValue(), "12.5");
        assert.equal(await page.locator("#payAmount").inputValue(), "12.5");
        await allocation.press("End");
        await allocation.pressSequentially("5");
        assert.equal(await allocation.inputValue(), "12.55");
        assert.equal(await page.locator("#payAmount").inputValue(), "12.55");
        await page.locator("#payAmount").fill("20");
        assert.equal(await allocation.inputValue(), "12.55");
        await page.locator("#payAmount").fill("");
        assert.equal(await page.locator("#payAmount").inputValue(), "12.55");
        await page.screenshot({ path: path.join(artifacts, `${language}-${direction.toLowerCase()}.png`), fullPage: true });

        for (const kind of ["SUPPLIER", "CUSTOMER", "EMPLOYEE", "ACCOUNT"]) {
          await select(page, "payPartyKind", t.counterpartyKinds[kind]);
          if (kind === "ACCOUNT") {
            assert.equal(await page.locator("#payParty").count(), 0);
            await select(page, "payCounterAccount", "Other account");
          } else {
            names = await options(page, "payParty");
            assert.equal(names.length, kind === "EMPLOYEE" ? 1 : 2);
            assert(names.every((name) => name.startsWith(kind) || (kind !== "EMPLOYEE" && name.startsWith("CUSTOMER_SUPPLIER"))));
            await activeList.getByRole("option").filter({ hasText: new RegExp(`^${kind} ·`) }).click();
            if (kind === "EMPLOYEE") {
              names = await options(page, "payCounterAccount");
              assert.deepEqual(names, ["employee-account — Employee account"]);
              await activeList.getByRole("option").click();
              assert.equal(await page.getByRole("textbox", { name: `${t.settleNow} INV-1`, exact: true }).count(), 0);
            }
          }
        }
        await select(page, "payPartyKind", t.counterpartyKinds[defaultKind]);
        await select(page, "payParty", new RegExp(`^${defaultKind} ·`));
        await allocation.fill("۱۲٫۵");
        assert.equal(await page.locator("#payAmount").inputValue(), "12.5");
        await page.getByRole("button", { name: t[direction === "RECEIPT" ? "receipt" : "payment"].submit, exact: true }).click();
        await page.getByText("TEST-1", { exact: true }).waitFor();
        assert.equal(submissions.length, 1);
        assert.deepEqual(submissions[0].allocations, [{ invoiceId: "invoice", amount: "12.5" }]);
        assert.equal(submissions[0].amount, "12.5");
        assert.equal(submissions[0].counterpartyKind, defaultKind);
        assert.equal(submissions[0].cashAccountId, "bank");
        await page.goto(base + (direction === "RECEIPT" ? "/payments/receipts/settle" : "/payments/supplier/settle"));
        await select(page, "setParty", new RegExp(`^${defaultKind} ·`));
        const settleInput = page.getByRole("textbox", { name: `${t.settleNow} INV-1`, exact: true });
        await settleInput.fill("١٢٫٥");
        await settleInput.press("End");
        await settleInput.pressSequentially("9");
        assert.equal(await settleInput.inputValue(), "12.59");
        await page.getByRole("button", { name: t.settle, exact: true }).click();
        await page.getByText(t.settleBalance.success, { exact: true }).waitFor();
        assert.deepEqual(settlements[0].allocations, [{ invoiceId: "invoice", amount: "12.59" }]);
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`PASS ${language} ${direction}: cash/bank methods, all party types, voucher and on-account settlement amounts`);
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
