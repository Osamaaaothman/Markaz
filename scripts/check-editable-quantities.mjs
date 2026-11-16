// Real browser regressions with isolated API fixtures; never writes business data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:5194';
const server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5194', '--strictPort'], { cwd: root + '/apps/web', stdio: 'ignore' });
let browser;
const errors = [];
await mkdir(root + '/output/navigation-review', { recursive: true });
try {
  for (let i = 0; i < 80; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    if (i === 79) throw Error('Preview unavailable');
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true });
  for (const lang of ['ar', 'en']) for (const direction of ['original', 'balance', 'canvas', 'precision']) for (const mode of ['light', 'dark']) {
    const copy = JSON.parse(await readFile(new URL(`../apps/web/src/locales/${lang}/common.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ lang, direction, mode }) => {
      localStorage.setItem('erp-auth', JSON.stringify({ state: { accessToken: 'x.' + btoa(JSON.stringify({ sub: 'qa' })) + '.x', refreshToken: 'fixture' }, version: 0 }));
      localStorage.setItem('erp-lang', lang);
      localStorage.setItem('erp-pwa-install-dismissed', String(Date.now()));
      localStorage.setItem('erp-theme', JSON.stringify({ state: { theme: direction === 'original' ? (mode === 'light' ? 'forest' : 'night') : direction + (mode === 'dark' ? 'dark' : ''), direction, mode, lastLight: 'forest', lastDark: 'night' }, version: 3 }));
    }, { lang, direction, mode });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let body;
    const lines = [{ id: 'line1', description: 'Pens', quantity: '600', deliveredQuantity: '0' }, { id: 'line2', description: 'Paper', quantity: '12', deliveredQuantity: '2' }];
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api/, '');
      if (req.method() === 'POST' && path === '/v1/goods-delivery-notes') {
        body = req.postDataJSON();
        return route.fulfill({ status: 422, json: { error: { code: 'VALIDATION_ERROR', message: 'Fixture response', details: [] } } });
      }
      if (req.method() !== 'GET') { errors.push('Unexpected mutation ' + path); return route.abort(); }
      let data;
      if (path === '/v1/users/me') data = { id: 'qa', companyId: 'qa', email: 'qa@example.test', companyName: 'Sample', companyDefaultCurrency: 'SAR', roles: [], permissions: ['sales_order:read', 'sales_delivery_note:read', 'sales_delivery_note:create'] };
      else if (path === '/v1/company/logo') return route.fulfill({ status: 404, json: {} });
      else if (path === '/v1/purchasing/pending-counts') data = {};
      else if (path === '/v1/sales-orders/order') data = { id: 'order', number: 'SO-TEST', status: 'CONFIRMED', customerName: 'Buyer', customerNameAr: 'عميل', lines };
      else if (path === '/v1/sales-orders') data = { data: [], pageInfo: { hasMore: false, nextCursor: null } };
      else if (path === '/v1/goods-delivery-notes') data = { data: [], pageInfo: { hasMore: false, nextCursor: null } };
      else { errors.push('Unexpected read ' + path); return route.fulfill({ status: 404, json: {} }); }
      return route.fulfill({ json: data });
    });
    await page.goto(base + '/sales/delivery-notes/new?order=order', { waitUntil: 'networkidle' });
    const qty = page.getByRole('textbox', { name: `${copy.sales.deliveryNotes.deliverNow}: Pens`, exact: true });
    const second = page.getByRole('textbox', { name: `${copy.sales.deliveryNotes.deliverNow}: Paper`, exact: true });
    const save = page.getByRole('button', { name: copy.sales.deliveryNotes.post, exact: true });
    assert.equal(await qty.inputValue(), '600');
    await save.click();
    await page.getByText(copy.sales.errors.generic, { exact: true }).waitFor();
    assert.deepEqual(body.lines, [{ salesOrderLineId: 'line1', quantity: '600' }, { salesOrderLineId: 'line2', quantity: '10' }]);
    await qty.fill('50');
    await second.fill('2.5');
    await page.locator('#dnDriver').fill('Driver');
    assert.equal(await qty.inputValue(), '50');
    assert.equal(await second.inputValue(), '2.5');
    body = null;
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/v1/goods-delivery-notes') && r.status() === 422),
      save.click(),
    ]);
    assert.deepEqual(body.lines, [{ salesOrderLineId: 'line1', quantity: '50' }, { salesOrderLineId: 'line2', quantity: '2.5' }]);
    await qty.fill(''); await second.fill('');
    assert.equal(await qty.inputValue(), '');
    assert.equal(await save.isDisabled(), true);
    await qty.fill('1.23456');
    assert.equal(await save.isDisabled(), true);
    await qty.fill('1.25');
    assert.equal(await save.isEnabled(), true);
    const icon = page.locator('.erp-sidebar__link--active .erp-sidebar__icon').first();
    assert.notEqual(await icon.evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    // The explicit profile entry bypasses the dismissed automatic banner.
    await page.getByRole('button', { name: copy.shell.profile, exact: true }).click();
    await page.locator('.erp-profile__actions').getByRole('button', { name: copy.pwa.install.action, exact: true }).click();
    await page.getByText(copy.pwa.install.browserGuide, { exact: true }).waitFor();
    await page.getByRole('button', { name: copy.pwa.install.close, exact: true }).click();
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.installCalls = (window.installCalls || 0) + 1; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: copy.shell.profile, exact: true }).click();
    await page.locator('.erp-profile__actions').getByRole('button', { name: copy.pwa.install.action, exact: true }).click();
    await page.locator('.mk-install').getByRole('button', { name: copy.pwa.install.action, exact: true }).click();
    assert.equal(await page.evaluate(() => window.installCalls), 1);
    const sidebar = page.locator('.erp-sidebar--desktop');
    const expand = sidebar.getByRole('button', { name: copy.shell.expandSidebar, exact: true });
    if (await expand.isVisible()) await expand.click();
    const collapse = sidebar.getByRole('button', { name: copy.shell.collapseSidebar, exact: true });
    assert.equal(await collapse.evaluate(el => Boolean(el.closest('.erp-sidebar__head'))), true);
    await collapse.click();
    await sidebar.getByRole('button', { name: copy.shell.expandSidebar, exact: true }).click();
    if (direction === 'balance' && mode === 'light') {
      await page.screenshot({ path: root + `/output/navigation-review/${lang}-desktop.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await qty.fill('25');
    assert.equal(await qty.inputValue(), '25');
    assert.ok((await qty.boundingBox()).width >= 90);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow');
    const back = page.locator('.erp-topbar').getByRole('button', { name: copy.shell.back, exact: true });
    assert.ok(await back.isVisible(), 'Back remains available on mobile');
    // Ensure the document can scroll, then change routes through the sticky topbar.
    await page.evaluate(() => { document.querySelector('main').style.minHeight = '2400px'; window.scrollTo(0, 600); });
    assert.ok(await page.evaluate(() => window.scrollY > 0), 'Scrolling remains enabled');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth), 'none');
    await back.click();
    await page.waitForURL(base + '/sales/delivery-notes');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Direct-link fallback starts at top');
    await page.getByRole('button', { name: copy.sales.deliveryNotes.new, exact: true }).first().click();
    await page.waitForURL(base + '/sales/delivery-notes/new');
    await page.evaluate(() => window.scrollTo(0, 600));
    await back.click();
    await page.waitForURL(base + '/sales/delivery-notes');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Back navigation starts at top');
    console.log(`PASS quantity editing, submitted values, profile install, sidebar: ${lang}/${direction}/${mode}`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); server.kill(); }
