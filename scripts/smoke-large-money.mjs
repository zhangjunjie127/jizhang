import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const records = [9999999999, 123456789, 1234567890].map((cents, index) => ({
  id: `large-${index}`, kind: 'expense', status: 'confirmed', created: `${date}T00:00:00Z`,
  payload: { cents, amount: cents / 100, date, title: `大额测试${index}`, category: '工资', direction: index ? 'expense' : 'income' },
}));
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'money-fixture', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
    records, messages: [], memories: [],
  } }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'money-fixture'));
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    await page.getByTestId('ledger-expense').waitFor();
    for (const tab of ['明细', '月账单', '年账单']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(150);
      const failures = await page.locator('.money-amount').evaluateAll(elements => elements.filter(el => {
        if (!el.checkVisibility()) return false;
        const outer = el.getBoundingClientRect(), inner = el.firstElementChild.getBoundingClientRect();
        return inner.width > outer.width + 1 || outer.right > innerWidth + 1 || outer.left < -1;
      }).map(el => ({ text: el.textContent, outer: el.getBoundingClientRect().toJSON(),
        inner: el.firstElementChild.getBoundingClientRect().toJSON(), font: getComputedStyle(el).font })));
      assert.deepEqual(failures, [], `${tab} at ${width}px: visible amounts must fit`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `artifacts/large-money-${width}-${tab}.png` });
    }
  }
  await page.getByRole('tab', { name: '明细', exact: true }).click();
  const amount = page.locator('[data-record-id="large-1"] .money-amount');
  await amount.evaluate(el => { el.parentElement.style.cssText = 'flex:0 0 220px;max-width:220px;width:220px'; });
  await page.waitForFunction(() => document.querySelector('[data-record-id="large-1"] .money-value')?.textContent === '-1,234,567.89');
  await amount.evaluate(el => { el.parentElement.style.cssText = 'flex:0 0 80px;max-width:80px;width:80px'; });
  await page.waitForFunction(() => document.querySelector('[data-record-id="large-1"] .money-value')?.textContent.includes('百万'));
  assert.equal(await amount.getAttribute('title'), '-1,234,567.89 元');
  const large = page.locator('[data-record-id="large-2"] .money-amount');
  await large.evaluate(el => { el.parentElement.style.cssText = 'flex:0 0 80px;max-width:80px;width:80px'; });
  await page.waitForFunction(() => document.querySelector('[data-record-id="large-2"] .money-value')?.textContent.includes('千万'));
  assert.deepEqual(errors, []);
  console.log('PASS: exact/compact amounts respond to available width, retain exact labels, and fit detail/month/year views at 320-1366px.');
} finally { await browser.close(); }
