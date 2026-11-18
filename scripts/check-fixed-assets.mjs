// Fixed-asset screens on the real built app with deterministic API fixtures. No live backend, no writes.
// Run: npm run build --workspace=@erp/web && node scripts/check-fixed-assets.mjs
// Checks every page in Arabic and English, desktop and phone width: no runtime error, no untranslated key,
// no horizontal page scroll, key text present. Screenshots land in output/fixed-assets-qa/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "http://127.0.0.1:5189";
const output = new URL("../output/fixed-assets-qa/", import.meta.url);
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, [root + "/node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "5189"], { cwd: root + "/apps/web", stdio: "ignore" });

const acc = (id, code, name, nameAr, type, normalBalance = type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT") => ({ id, code, name, nameAr, type, normalBalance });
const accounts = [
  acc("bank", "1102001", "Main bank", "البنك الرئيسي", "ASSET"),
  acc("veh", "1210001", "Vehicles", "السيارات", "ASSET"),
  acc("veh-acc", "1219001", "Accumulated depreciation - vehicles", "مجمع إهلاك السيارات", "ASSET", "CREDIT"),
  acc("dep", "6210001", "Depreciation expense", "مصروف الإهلاك", "EXPENSE"),
];
const ref = (a) => ({ id: a.id, code: a.code, name: a.name, nameAr: a.nameAr });
const categories = [
  { id: "cat-veh", code: "VEH", name: "Vehicles", nameAr: "سيارات", numberPrefix: "VEH", depreciationMethod: "STRAIGHT_LINE", isDepreciable: true, defaultUsefulLifeMonths: 60, defaultResidualPercent: "10.0000", assetAccount: ref(accounts[1]), accumulatedDepreciationAccount: ref(accounts[2]), depreciationExpenseAccount: ref(accounts[3]), isActive: true, assetCount: 2, isLocked: true },
  { id: "cat-lnd", code: "LND", name: "Land", nameAr: "أراضي", numberPrefix: "LND", depreciationMethod: "STRAIGHT_LINE", isDepreciable: false, defaultUsefulLifeMonths: null, defaultResidualPercent: "0.0000", assetAccount: ref(accounts[1]), accumulatedDepreciationAccount: null, depreciationExpenseAccount: null, isActive: true, assetCount: 0, isLocked: false },
];
const catRef = { id: "cat-veh", code: "VEH", name: "Vehicles", nameAr: "سيارات" };
const summary = (id, number, name, nameAr, status, cost, accd) => ({
  id, number, name, nameAr, status, category: catRef, acquisitionDate: "2026-01-01", inServiceDate: "2026-01-01", acquisitionCost: cost, residualValue: "1200.0000",
  usefulLifeMonths: 60, accumulatedDepreciation: accd, netBookValue: (Number(cost) - Number(accd)).toFixed(4), depreciatedThrough: status === "DRAFT" ? null : "2026-10-31",
  currency: "SAR", sourceType: "MANUAL", custodian: { id: "emp-1", ref: "EMP-000001", name: "Ahmad Ali", nameAr: "أحمد علي" }, costCenter: null, location: "Riyadh HQ",
});
const assets = [
  summary("fa-1", "VEH-000001", "Toyota Hilux 2026", "تويوتا هايلكس 2026", "ACTIVE", "120000.0000", "17700.0000"),
  summary("fa-2", "VEH-000002", "Delivery van", "فان توصيل", "DRAFT", "85000.0000", "0.0000"),
];
const history = Array.from({ length: 10 }, (_, i) => ({ runId: `run-${i + 1}`, runNumber: `DEP-2026-${String(i + 1).padStart(6, "0")}`, periodYear: 2026, periodMonth: i + 1, fromDate: `2026-${String(i + 1).padStart(2, "0")}-01`, toDate: `2026-${String(i + 1).padStart(2, "0")}-28`, days: 30, amount: "1770.0000", accumulatedAfter: (1770 * (i + 1)).toFixed(4), netBookValueAfter: (120000 - 1770 * (i + 1)).toFixed(4), isCatchUp: i === 0, journalEntryId: "je-1" }));
const projected = Array.from({ length: 6 }, (_, i) => ({ year: 2026 + Math.floor((10 + i) / 12), month: ((10 + i) % 12) + 1, fromDate: "2026-11-01", toDate: "2026-11-30", days: 30, amount: "1770.0000", accumulated: (17700 + 1770 * (i + 1)).toFixed(4), netBookValue: (102300 - 1770 * (i + 1)).toFixed(4) }));
const detail = { ...assets[0], description: "Field operations pickup", depreciationMethod: "STRAIGHT_LINE", isDepreciable: true, openingAccumulatedDepreciation: "0.0000", openingAsOfDate: null, lastDepreciationDay: "2030-12-31", serialNumber: "JTF-889921", barcode: "4006381333931", supplier: { id: "sup-1", ref: "PRT-000010", name: "Abdul Latif Jameel" }, sourceAccount: ref(accounts[0]), capitalizationJournalEntryId: "je-0", capitalizedAt: "2026-01-01T08:00:00Z", supplierInvoiceId: null, disposal: null, depreciationHistory: history, projectedSchedule: projected, transfers: [{ id: "t1", transferDate: "2026-03-01", fromLocation: "Jeddah", toLocation: "Riyadh HQ", fromCustodian: null, toCustodian: "Ahmad Ali", fromCostCenter: null, toCostCenter: null, reason: "Branch move" }], version: 3 };
const runLines = [{ assetId: "fa-1", assetNumber: "VEH-000001", assetName: "Toyota Hilux 2026", assetNameAr: "تويوتا هايلكس 2026", categoryName: "Vehicles", categoryNameAr: "سيارات", costCenterId: null, fromDate: "2026-10-01", toDate: "2026-10-31", days: 31, amount: "1770.0000", accumulatedAfter: "17700.0000", netBookValueAfter: "102300.0000", isCatchUp: false, fullyDepreciated: false }];
const run = { id: "run-10", number: "DEP-2026-000010", periodYear: 2026, periodMonth: 10, runDate: "2026-10-31", currency: "SAR", totalAmount: "1770.0000", assetCount: 1, status: "POSTED", journalEntryId: "je-1", reversalJournalEntryId: null, reversalReason: null, reversedAt: null, createdAt: "2026-11-01T08:00:00Z" };
const movementRow = { costOpening: "0.0000", costAdditions: "120000.0000", costDisposals: "0.0000", costClosing: "120000.0000", depreciationOpening: "0.0000", depreciationOnOpeningAssets: "0.0000", depreciationCharge: "17700.0000", depreciationOnDisposals: "0.0000", depreciationClosing: "17700.0000", netBookValueOpening: "0.0000", netBookValueClosing: "102300.0000" };

function fixture(path, url) {
  if (path === "/v1/users/me")
    return { id: "qa", email: "qa@example.test", companyId: "sample", companyName: "Sample company", companyNameAr: "شركة تجريبية", companyDefaultCurrency: "SAR", ref: "QA", roles: [], permissions: ["fixed_asset:read", "fixed_asset:create", "fixed_asset:update", "fixed_asset:capitalize", "fixed_asset:dispose", "fixed_asset_category:read", "fixed_asset_category:manage", "depreciation_run:read", "depreciation_run:post", "depreciation_run:reverse", "account:read", "employee:read", "party:read"] };
  if (path === "/v1/purchasing/pending-counts") return {};
  if (path === "/v1/accounts") return accounts;
  if (path === "/v1/employees/all") return [{ id: "emp-1", ref: "EMP-000001", name: "Ahmad Ali", nameAr: "أحمد علي" }];
  if (path === "/v1/cost-centers") return [];
  if (path === "/v1/parties") return { data: [{ id: "sup-1", ref: "PRT-000010", name: "Abdul Latif Jameel", nameAr: null, kind: "COMPANY" }], pageInfo: { hasMore: false, nextCursor: null } };
  if (path === "/v1/fixed-asset-categories") return categories;
  if (path === "/v1/fixed-assets") return { items: assets, total: 2, page: 1, pageSize: 25, totals: { acquisitionCost: "120000.0000", accumulatedDepreciation: "17700.0000", netBookValue: "102300.0000" } };
  if (path === "/v1/fixed-assets/fa-1") return detail;
  if (path === "/v1/fixed-assets/fa-1/disposal-preview")
    return { assetId: "fa-1", disposalDate: url.searchParams.get("disposalDate"), cost: "120000.0000", accumulatedBefore: "17700.0000", finalDepreciationAmount: "1062.0000", finalDepreciationDays: 18, finalDepreciationFrom: "2026-11-01", accumulatedAtDisposal: "18762.0000", netBookValue: "101238.0000", gainLoss: "-101238.0000", lines: [{ accountId: "dep", accountCode: "6210001", accountName: "Depreciation expense", accountNameAr: "مصروف الإهلاك", debit: "1062.0000", credit: "0.0000" }, { accountId: "veh-acc", accountCode: "1219001", accountName: "Accumulated depreciation - vehicles", accountNameAr: "مجمع إهلاك السيارات", debit: "18762.0000", credit: "1062.0000" }, { accountId: "veh", accountCode: "1210001", accountName: "Vehicles", accountNameAr: "السيارات", debit: "0.0000", credit: "120000.0000" }] };
  if (path === "/v1/depreciation-runs") return [run];
  if (path === "/v1/depreciation-runs/preview") return { periodYear: 2026, periodMonth: 11, runDate: "2026-11-30", currency: "SAR", totalAmount: "1770.0000", lines: [{ ...runLines[0], fromDate: "2026-11-01", toDate: "2026-11-30", days: 30, isCatchUp: true }] };
  if (path === "/v1/depreciation-runs/run-10") return { ...run, lines: runLines, canReverse: true };
  if (path === "/v1/fixed-assets/reports/register")
    return { asOf: url.searchParams.get("asOf"), currency: "SAR", rows: [{ assetId: "fa-1", number: "VEH-000001", name: "Toyota Hilux 2026", nameAr: "تويوتا هايلكس 2026", categoryId: "cat-veh", categoryName: "Vehicles", categoryNameAr: "سيارات", inServiceDate: "2026-01-01", usefulLifeMonths: 60, cost: "120000.0000", accumulatedDepreciation: "17700.0000", netBookValue: "102300.0000", location: "Riyadh HQ", custodianName: "Ahmad Ali" }], byCategory: [{ categoryId: "cat-veh", categoryName: "Vehicles", categoryNameAr: "سيارات", count: 1, cost: "120000.0000", accumulatedDepreciation: "17700.0000", netBookValue: "102300.0000" }], totals: { count: 1, cost: "120000.0000", accumulatedDepreciation: "17700.0000", netBookValue: "102300.0000" } };
  if (path === "/v1/fixed-assets/reports/movement") return { from: "2026-01-01", to: "2026-11-19", currency: "SAR", rows: [{ categoryId: "cat-veh", categoryName: "Vehicles", categoryNameAr: "سيارات", ...movementRow }], totals: movementRow };
  if (path === "/v1/fixed-assets/reports/reconciliation") return { asOf: "2026-11-19", currency: "SAR", isReconciled: true, rows: [{ accountId: "veh", accountCode: "1210001", accountName: "Vehicles", accountNameAr: "السيارات", role: "COST", registerAmount: "120000.0000", ledgerAmount: "120000.0000", difference: "0.0000" }, { accountId: "veh-acc", accountCode: "1219001", accountName: "Accumulated depreciation - vehicles", accountNameAr: "مجمع إهلاك السيارات", role: "ACCUMULATED_DEPRECIATION", registerAmount: "17700.0000", ledgerAmount: "17700.0000", difference: "0.0000" }] };
  return undefined;
}

// [name, path, text that must appear (by language), optional interaction]
const pages = [
  ["list", "/fixed-assets", { en: "VEH-000001", ar: "VEH-000001" }],
  ["new", "/fixed-assets/new", { en: "New fixed asset", ar: "أصل ثابت جديد" }],
  ["opening", "/fixed-assets/opening", { en: "Register an opening asset", ar: "تسجيل أصل افتتاحي" }],
  ["detail", "/fixed-assets/fa-1", { en: "Toyota Hilux 2026", ar: "تويوتا هايلكس 2026" }],
  ["schedule", "/fixed-assets/fa-1", { en: "Projected", ar: "متوقع" }, (p, t) => p.getByRole("tab", { name: t.fixedAssets.detail.tabs.schedule }).click()],
  ["dispose", "/fixed-assets/fa-1", { en: "Dispose of asset", ar: "استبعاد الأصل" }, (p, t) => p.getByRole("button", { name: t.fixedAssets.detail.dispose }).first().click()],
  ["categories", "/fixed-assets/categories", { en: "Accumulated depreciation - vehicles", ar: "مجمع إهلاك السيارات" }],
  ["runs", "/fixed-assets/depreciation-runs", { en: "DEP-2026-000010", ar: "DEP-2026-000010" }],
  ["run-dialog", "/fixed-assets/depreciation-runs", { en: "Catch-up", ar: "تعويض" }, (p, t) => p.getByRole("button", { name: t.fixedAssets.runs.run }).first().click()],
  ["run-detail", "/fixed-assets/depreciation-runs/run-10", { en: "Reverse run", ar: "عكس التشغيل" }],
  ["report-register", "/fixed-assets/reports?tab=register", { en: "102,300.00", ar: "102,300.00" }],
  ["report-movement", "/fixed-assets/reports?tab=movement", { en: "Opening assets", ar: "أصول افتتاحية" }],
  ["report-reconciliation", "/fixed-assets/reports?tab=reconciliation", { en: "The register agrees with the ledger.", ar: "السجل مطابق للدفاتر." }],
];

const failures = [];
const unknown = new Set();
let browser;
let cases = 0;
try {
  for (let i = 0; i < 80; i++) {
    if (await fetch(base).then((r) => r.ok).catch(() => false)) break;
    if (i === 79) throw Error("Application preview did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true });
  const { readFile } = await import("node:fs/promises");
  for (const lang of ["ar", "en"]) {
    const copy = JSON.parse(await readFile(new URL(`../apps/web/src/locales/${lang}/common.json`, import.meta.url), "utf8"));
    for (const [device, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      await context.addInitScript((lang) => {
        localStorage.setItem("erp-auth", JSON.stringify({ state: { accessToken: "local-fixture", refreshToken: "local-fixture" }, version: 0 }));
        localStorage.setItem("erp-lang", lang);
      }, lang);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname.replace(/^\/api/, "");
        if (req.method() !== "GET") {
          errors.push("Unexpected mutation " + path);
          return route.abort();
        }
        const data = fixture(path, url);
        if (data === undefined) {
          unknown.add(path);
          return route.fulfill({ status: 404, json: {} });
        }
        return route.fulfill({ json: data });
      });
      for (const [name, path, expected, act] of pages) {
        errors.length = 0;
        await page.goto(base + path);
        await page.waitForLoadState("networkidle");
        if (act) {
          await act(page, copy);
          await page.waitForTimeout(400);
          await page.waitForLoadState("networkidle");
        }
        const text = await page.locator("body").innerText();
        const label = `${lang}/${device}/${name}`;
        if (!text.toLowerCase().includes(expected[lang].toLowerCase())) failures.push(`${label}: missing "${expected[lang]}"`);
        const raw = text.match(/\bfixedAssets\.[A-Za-z.]+/);
        if (raw) failures.push(`${label}: untranslated key ${raw[0]}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) failures.push(`${label}: horizontal page scroll ${overflow}px`);
        const dir = await page.evaluate(() => document.documentElement.dir);
        if (dir !== (lang === "ar" ? "rtl" : "ltr")) failures.push(`${label}: dir=${dir}`);
        for (const e of errors) failures.push(`${label}: ${e}`);
        await page.screenshot({ path: fileURLToPath(new URL(`${lang}-${device}-${name}.png`, output)), fullPage: true });
        cases++;
      }
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
if (unknown.size) console.log("Unmocked GETs (served 404):", [...unknown].sort().join(", "));
console.log(`fixed-assets browser check: ${cases} page renders, ${failures.length} failure(s)`);
for (const f of failures) console.log(" - " + f);
assert.equal(failures.length, 0);
