import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'checkin-ui-only', name: '测试', username: 'checkin-ui', persona: 'gentle', adult: true, relationship: 'friend' },
    records: [], memories: [],
    messages: [{ id: 'checkin-ui-message', role: 'assistant', persona: 'gentle', proactive: 1, text: '测试主动询问', created: '2026-09-17T10:00:00Z' }],
  } }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'ui-fixture-not-a-real-token'));
  await page.goto(base);
  const chat = page.getByRole('button', { name: '助手', exact: true });
  await chat.locator('i').waitFor();
  await chat.click();
  await page.getByText('测试主动询问', { exact: true }).waitFor();
  await chat.locator('i').waitFor({ state: 'detached' });
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  await page.reload();
  await page.getByRole('heading', { name: '记账', exact: true }).waitFor();
  assert.equal(await chat.locator('i').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: proactive badge, shared chat, read marker persists after reload; no backend data written');
} finally { await browser.close(); }
