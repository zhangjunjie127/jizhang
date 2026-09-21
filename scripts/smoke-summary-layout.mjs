import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  let cents = 9170;
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'layout-only', name: '排版测试', username: 'layout-only', persona: 'gentle', relationship: 'friend', adult: true },
    memories: [], messages: [], records: ['expense', 'income'].map((direction, index) => ({
      id: `layout-${index}`, kind: 'expense', status: 'confirmed', created: `${day}T00:00:00Z`,
      payload: { title: '仅浏览器模拟', category: '其他', direction, cents, date: day },
    })),
  } }));
  await page.addInitScript(() => {
    localStorage.setItem('zaizai-token', 'layout-only-not-a-real-token');
    localStorage.setItem('zaizai-page', 'ledger');
  });
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    for (const amount of [9170, 11150, 999999, 1000000, 7865000, 100000000, 1234567890123]) {
      cents = amount;
      await page.goto(base);
      await page.getByTestId('ledger-expense').waitFor();
      const expected = `${(amount / (amount >= 1000000 ? 1000000 : 100)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${amount >= 1000000 ? '万' : ''}`;
      assert.equal(await page.getByTestId('ledger-expense').textContent(), expected);
      const wrapped = await page.locator('.ledger-summary strong, .ledger-amount, .day-totals>span').evaluateAll(elements => elements.filter(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size !== 1 || element.scrollWidth > element.clientWidth + 1;
      }).map(element => element.textContent));
      assert.deepEqual(wrapped, [], `Amounts must fit a single line at ${width}px: ${amount}`);
      if (width === 390 && amount === 11150) {
        const baselines = await page.locator('.ledger-summary').evaluate(summary => {
          const baseline = selector => {
            const marker = document.createElement('i');
            marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';
            summary.querySelector(selector).append(marker);
            const top = marker.getBoundingClientRect().top;
            marker.remove();
            return top;
          };
          return [
            [baseline('.summary-expense>strong'), baseline('.summary-income>strong')],
            [baseline('.summary-expense>span'), baseline('.summary-average>strong')],
          ];
        });
        for (const [left, right] of baselines) assert.ok(Math.abs(left - right) <= 1, 'Right-hand values must align with left-hand text baselines');
      }
      const metrics = await page.locator('.ledger-summary').evaluate(summary => {
        const rect = element => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return { left, right, top, bottom };
        };
        return {
          width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
          amounts: [...summary.querySelectorAll('strong')].map(rect),
          pairs: [...summary.querySelectorAll('.summary-income, .summary-average')].map(row => ({
            label: rect(row.querySelector('span')), number: rect(row.querySelector('strong')),
          })),
        };
      });
      assert.equal(metrics.overflow, false);
      for (const number of metrics.amounts) {
        assert.ok(number.left >= 0 && number.right <= metrics.width - 24);
      }
      for (const { label, number } of metrics.pairs) {
        assert.ok(label.right + 10 <= number.left || label.bottom <= number.top, 'Label and number must have spacing or separate rows');
      }
      await page.screenshot({ path: `artifacts/summary-${width}-${amount}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: normal and large amounts at 320/390/1366px; spacing, bounds and no page errors. No financial data written.');
} finally {
  await browser.close();
}
