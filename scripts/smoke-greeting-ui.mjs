import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts/greetings', { recursive: true });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.clock.install({ time: new Date('2026-10-12T12:00:00+08:00') });
    let requests = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const greeting = { id: 'greeting-fixture', role: 'assistant', persona: 'calm', proactive: 1,
      text: '午间路过，给今天添一句轻巧的问候。', created: '2026-10-12T04:01:00Z' };
    const state = () => ({
      user: { id: 'greeting-ui', name: '测试', persona: 'calm', adult: true, proactive: 1, relationship: 'friend' },
      records: [], memories: [], messages: requests ? [greeting] : [], ai: { configured: true },
    });
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/assistant/greeting')) {
        requests++;
        return route.fulfill({ json: { greeting: requests === 1 ? greeting : null } });
      }
      return route.fulfill({ json: state() });
    });
    await page.addInitScript(() => localStorage.setItem('zaizai-token', 'synthetic-ui-only'));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    await page.getByRole('heading', { name: '记账', exact: true }).waitFor();
    await page.clock.fastForward(61000);
    const bubble = page.getByRole('status', { name: '助手问候' });
    await bubble.waitFor();
    await page.clock.runFor(250);
    const bounds = await bubble.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: `artifacts/greetings/bubble-${width}.png` });
    if (width === 320) {
      await page.clock.fastForward(16000);
      await bubble.waitFor({ state: 'detached' });
    } else if (width === 390) {
      await page.getByRole('button', { name: '收起问候', exact: true }).click();
      await bubble.waitFor({ state: 'detached' });
    } else {
      await bubble.getByRole('button', { name: greeting.text, exact: true }).click();
      await page.locator('.assistant-panel').waitFor();
      await page.locator('.assistant-panel').getByText(greeting.text, { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: bubble at 320/390/1280px, dismiss, auto-hide, open conversation and persisted greeting.');
} finally { await browser.close(); }
