import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  await page.route('**/api/state', route => {
    authenticated = route.request().headers().authorization === 'Bearer overlay-fixture-only';
    return route.fulfill({ json: {
      user: { id: 'overlay-fixture', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
      records: [], memories: [], messages: [{ id: 'history', role: 'assistant', text: '已有聊天记录', created: new Date().toISOString() }],
    } });
  });
  await page.addInitScript(() => {
    window.__ZAIZAI_OVERLAY__ = { token: 'overlay-fixture-only', base: location.origin, userId: 'overlay-fixture' };
    localStorage.setItem('zaizai-token', 'different-main-token');
    window.nativeActions = [];
    window.ZaizaiAssistant = {
      collapse() { window.nativeActions.push('collapse'); },
      stop() { window.nativeActions.push('stop'); },
      setCallActive(active) { window.nativeActions.push(['active', active]); },
      prepareCall() {
        window.nativeActions.push('prepare');
        window.dispatchEvent(new CustomEvent('assistant-voice-error', { detail: '需要允许麦克风权限才能通话' }));
      },
    };
    navigator.mediaDevices.getUserMedia = () => { throw new Error('Microphone must not be touched before native authorization'); };
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.getByText('已有聊天记录', { exact: true }).waitFor();
  assert.equal(authenticated, true, 'Overlay API uses its own in-memory session');
  assert.equal(await page.locator('.ledger-page').count(), 0);
  assert.equal(await page.locator('.mobile-nav').isVisible(), false);
  const surface = await page.getByRole('dialog', { name: '助手对话' }).boundingBox();
  assert.deepEqual(surface, { x: 0, y: 0, width: 320, height: 480 });
  await page.getByRole('button', { name: '收起助手', exact: true }).click();
  assert.ok(await page.evaluate(() => window.nativeActions.includes('collapse')));
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.getByText('需要允许麦克风权限才能通话', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.nativeActions.includes('prepare')));
  assert.equal(await page.locator('.assistant-call-controls').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: native-host web surface, isolated in-memory session, collapse bridge and microphone-denial handshake. Native OS behavior still requires a device.');
} finally { await browser.close(); }
