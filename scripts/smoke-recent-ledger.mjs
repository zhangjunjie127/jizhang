import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const day = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const today = day(Date.now()), yesterday = day(Date.now() - 86400000);
const record = (id, date, direction = 'expense', status = 'confirmed') => ({
  id, kind: 'expense', status, revision: 0, created: `${date}T00:00:00Z`,
  payload: { title: id, date, direction, cents: 100, amount: 1, category: '其他' },
});
let records = [
  record('今天支出', today), record('今天收入', today, 'income'),
  record('昨天支出', yesterday), record('历史账目', '2020-01-02'),
  ...Array.from({ length: 5 }, (_, i) => record(`草稿${i}`, today, 'expense', 'pending')),
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'recent-fixture', name: '测试', username: 'recent-fixture', persona: 'gentle', adult: true },
    records, messages: [], memories: [],
  } }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'ui-fixture-only'));
  await page.goto(base);
  await page.getByRole('heading', { name: '记账', exact: true }).waitFor();
  assert.equal(await page.locator('.pending-row').count(), 2);
  await page.getByRole('button', { name: '展开全部（5 条）', exact: true }).click();
  assert.equal(await page.locator('.pending-row').count(), 5);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  assert.equal(await page.locator('.pending-row').count(), 2);
  await page.getByRole('button', { name: /批量核对账目/ }).click();
  assert.equal(await page.locator('.batch-row').count(), 5);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: '今天收支', exact: true }).locator('.ledger-row').count(), 2);
  assert.equal(await page.getByRole('region', { name: '昨天收支', exact: true }).locator('.ledger-row').count(), 1);
  assert.equal(await page.getByRole('button', { name: '修改历史账目' }).count(), 0);
  await page.screenshot({ path: 'artifacts/ledger-recent-mobile.png', fullPage: true });
  await page.getByRole('tab', { name: '明细', exact: true }).click();
  await page.getByLabel('查询账目日期').fill('2020-01-02');
  assert.equal(await page.getByLabel('账本月份').inputValue(), '2020-01');
  assert.equal(await page.locator('.ledger-row').count(), 1);
  await page.getByRole('button', { name: '修改历史账目' }).waitFor();
  assert.equal(await page.getByTestId('ledger-expense').innerText(), '1.00');
  await page.getByRole('button', { name: '清除日期，查看整月' }).click();
  assert.equal(await page.getByLabel('查询账目日期').inputValue(), '');
  await page.getByLabel('搜索账目').fill('历史');
  assert.equal(await page.locator('.ledger-row').count(), 1);
  assert.equal(await page.getByLabel('筛选收支').count(), 0);
  await page.getByRole('button', { name: '收支与分类筛选' }).click();
  await page.getByLabel('筛选收支').selectOption('income');
  assert.equal(await page.locator('.ledger-row').count(), 0);
  await page.getByLabel('筛选收支').selectOption('expense');
  await page.getByLabel('筛选分类').selectOption('其他');
  assert.equal(await page.locator('.ledger-row').count(), 1);
  await page.getByRole('button', { name: '收支与分类筛选' }).click();
  await page.getByRole('button', { name: '清除分类筛选' }).click();
  assert.equal(await page.getByRole('button', { name: '清除分类筛选' }).count(), 0);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByLabel('账本月份').fill(today.slice(0, 7));
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.ledger-viewbar').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok((await page.locator('.ledger-query').boundingBox()).height < 160, 'Default query panel stays compact');
    await page.screenshot({ path: `artifacts/ledger-query-${width}.png` });
  }
  await page.getByRole('button', { name: '收支与分类筛选' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ledger-query').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ledger-query-expanded.png' });
  await page.getByLabel('账本月份').fill('2020-01');
  await page.getByLabel('查询账目日期').fill('2020-01-03');
  assert.equal(await page.locator('.ledger-row').count(), 0);
  await page.getByRole('tab', { name: '概览', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: '今天收支', exact: true }).locator('.ledger-row').count(), 2);
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('tab', { name: '统计', exact: true }).click();
  assert.equal(await page.locator('.category-symbol svg').count(), await page.locator('.category-line').count());
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('.category-line').first().boundingBox();
    assert.ok(bounds.x >= 30 && bounds.x + bounds.width <= width - 30, 'Statistics keeps inner side margins');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `artifacts/ledger-statistics-${width}.png`, fullPage: true });
  }
  records = [];
  await page.reload();
  await page.getByRole('region', { name: '今天收支', exact: true }).waitFor();
  assert.equal(await page.getByText('暂无收支记录', { exact: true }).count(), 2);
  assert.deepEqual(errors, []);
  console.log('PASS: two-draft collapse, full batch review, today/yesterday details, historical date query, empty days and responsive layout; no backend records written');
} finally { await browser.close(); }
