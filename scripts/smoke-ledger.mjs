import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
let token;
async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const account = await api('/register', { username: `ledger-ui-${Date.now()}`, password: 'LedgerUiTest916!', birthday: '2000-01-01', name: '账本测试', invite: process.env.INVITE_CODE });
token = account.token;
await api('/profile', { proactive: false }, 'PATCH');
const ids = [];
for (const [title, amount, category] of [['午饭', 28, '餐饮'], ['地铁', 6, '交通'], ['买菜', 42, '餐饮']]) {
  ids.push((await api('/records', { kind: 'expense', payload: { title, amount, category, date: day } })).proposed.id);
}
await api('/records', { kind: 'expense', confirmed: true, payload: { title: '工资', amount: 5000, direction: 'income', category: '工资', date: day } });
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(token => localStorage.setItem('zaizai-token', token), token);
  await page.goto(base);
  await page.locator('.sidebar nav').getByRole('button', { name: '记账', exact: true }).click();
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '0.00');
  await page.getByRole('button', { name: /批量核对账目/ }).click();
  const dialog = page.getByRole('dialog', { name: '批量核对账目' });
  const lunch = dialog.locator('.batch-row').filter({ has: page.locator('input[value="午饭"]') });
  await lunch.locator('input[type="number"]').fill('18');
  await page.screenshot({ path: 'artifacts/ledger-batch-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await dialog.locator('.modal-actions').scrollIntoViewIfNeeded();
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), 'Batch dialog overflow');
  const dialogBounds = await dialog.boundingBox();
  const headingBounds = await dialog.locator('.modal-heading').boundingBox();
  assert.ok(headingBounds.y >= dialogBounds.y - 1, 'Batch heading must remain visible');
  await page.screenshot({ path: 'artifacts/ledger-batch-mobile.png' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await dialog.getByRole('button', { name: '确认保存 3 笔' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '66.00');
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByRole('button', { name: '午餐', exact: true }).click();
  await page.getByLabel('金额（元）', { exact: true }).fill('10');
  await page.getByLabel('备注', { exact: true }).fill('咖啡');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '76.00');
  await page.getByRole('button', { name: '修改咖啡', exact: true }).click();
  await page.getByLabel('金额（元）', { exact: true }).fill('12');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '78.00');
  await page.getByRole('button', { name: '删除咖啡', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="ledger-expense"]').textContent === '66.00');
  await page.getByRole('button', { name: '账目回收站', exact: true }).click();
  await page.getByRole('button', { name: '恢复咖啡', exact: true }).click();
  await page.getByText('回收站是空的', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '明细', exact: true }).click();
  await page.getByLabel('搜索账目').fill('咖啡');
  assert.equal(await page.locator('.ledger-row').count(), 1);
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '12.00');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出筛选账目' }).click();
  const downloaded = await downloading;
  const csv = readFileSync(await downloaded.path(), 'utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('咖啡'));
  assert.ok(!csv.includes('午饭'));
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByRole('tab', { name: '统计', exact: true }).click();
  await page.getByRole('button', { name: '查看交通支出' }).click();
  assert.equal(await page.locator('.ledger-row').count(), 1);
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '6.00');
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByLabel('账本月份').fill('2000-01');
  assert.equal(await page.locator('.ledger-row').count(), 0);
  await page.getByLabel('账本月份').fill(day.slice(0, 7));
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10000 });
  await page.screenshot({ path: 'artifacts/ledger-desktop-v2.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    await page.screenshot({ path: `artifacts/ledger-mobile-${width}-v2.png`, fullPage: true });
  }
  await page.reload();
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '78.00');
  assert.deepEqual(errors, []);
  const report = { passed: true, manualSave: true, batchEditAndConfirm: true, correction: true, trashRestore: true,
    searchAndCategoryAndMonth: true, filteredCsv: true, reload: true, widths: [1366, 390, 320], errors };
  writeFileSync('artifacts/ledger-ui-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
