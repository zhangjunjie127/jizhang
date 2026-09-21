import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
assert(process.env.TEST_USERNAME && process.env.TEST_PASSWORD, 'Set TEST_USERNAME and TEST_PASSWORD.');
const login = await fetch(`${base}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD }),
}).then(r => r.json());
assert.ok(login.token);
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${resolve('artifacts/synthetic-input.wav')}`,
    '--autoplay-policy=no-user-gesture-required',
    `--unsafely-treat-insecure-origin-as-secure=${base}`,
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(token => {
    localStorage.setItem('zaizai-token', token);
    window.voiceEvents = [];
    window.voiceConnections = 0;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        if (new URL(args[0], location.href).pathname !== '/voice') return;
        window.voiceConnections++;
        this.addEventListener('message', ({ data }) => {
          const event = JSON.parse(data);
          window.voiceEvents.push({ direction: 'in', type: event.type, time: performance.now(), status: event.response?.status, code: event.error?.code, error: event.error?.message || event.message, messageId: event.message?.id, messageText: event.message?.text });
        });
      }
      send(data) {
        const event = JSON.parse(data);
        if (event.type !== 'input_audio_buffer.append' && event.type !== 'auth') window.voiceEvents.push({ direction: 'out', type: event.type, time: performance.now() });
        super.send(data);
      }
    };
  }, login.token);
  await page.goto(base);
  await page.getByRole('button', { name: '展开助手', exact: true }).click({ position: { x: 12, y: 32 } });
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.waitForFunction(() => window.voiceEvents.some(e => e.type === 'app.ready'), undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.voiceEvents.some(e => e.type === 'response.output_audio.delta'), undefined, { timeout: 45000 });
  assert.equal(await page.locator('.call-overlay').count(), 0);
  assert.equal(await page.locator('.ledger-page').isVisible(), true);
  await page.screenshot({ path: 'artifacts/voice-mobile.png' });
  let interrupted = false;
  try {
    await page.waitForFunction(() => window.voiceEvents.some(e => e.type === 'conversation.item.truncate'), undefined, { timeout: 30000 });
    interrupted = true;
    await page.waitForTimeout(700);
  } catch {}
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByRole('button', { name: '午餐', exact: true }).click();
  await page.getByLabel('金额（元）', { exact: true }).fill('9.90');
  await page.getByLabel('备注', { exact: true }).fill('通话中操作测试');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '记一笔', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '展开通话助手', exact: true }).count(), 1);
  await page.screenshot({ path: 'artifacts/voice-with-ledger-mobile.png' });
  await page.getByRole('button', { name: '展开通话助手', exact: true }).click({ position: { x: 12, y: 32 } });
  assert.equal(await page.getByRole('button', { name: '发起语音通话', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.voiceConnections), 1, 'Call button must not open a second call');
  const typed = `通话中的文字测试 ${Date.now()}，请只说收到。`;
  await page.getByRole('textbox', { name: '发送给助手的消息' }).fill(typed);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(value => window.voiceEvents.some(e => e.type === 'app.message' && e.messageText === value), typed, { timeout: 10000 });
  const typedId = await page.evaluate(value => window.voiceEvents.find(e => e.messageText === value).messageId, typed);
  assert.equal(await page.locator(`[data-message-id="${typedId}"]`).count(), 1);
  const composer = await page.locator('.composer').boundingBox();
  const dock = await page.locator('.assistant-call-controls').boundingBox();
  assert.ok(dock.y + dock.height <= composer.y + 1, 'Call controls must not cover the composer');
  await page.screenshot({ path: 'artifacts/voice-shared-chat-mobile.png' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({ path: 'artifacts/voice-shared-chat-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const events = await page.evaluate(() => window.voiceEvents);
  await page.getByRole('button', { name: '结束通话', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.waitForFunction(() => window.voiceEvents.filter(e => e.type === 'app.ready').length === 2, undefined, { timeout: 30000 });
  assert.equal(await page.locator(`[data-message-id="${typedId}"]`).count(), 1, 'Second call must preserve the first call history');
  await page.getByRole('button', { name: '结束通话', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '展开助手', exact: true }).click({ position: { x: 12, y: 32 } });
  await page.locator(`[data-message-id="${typedId}"]`).waitFor();
  const report = {
    fakeMicrophone: true,
    ready: events.some(e => e.type === 'app.ready'),
    userTranscript: events.some(e => e.type === 'conversation.item.input_audio_transcription.completed'),
    audioOutput: events.some(e => e.type === 'response.output_audio.delta'),
    interrupted,
    cancelSent: events.some(e => e.type === 'response.cancel'),
    serverCancelled: events.some(e => e.type === 'response.done' && e.status === 'cancelled'),
    harmlessCancelRaces: events.filter(e => e.code === 'response_cancel_not_active').length,
    nonBlockingLedger: true,
    typingDuringCall: true,
    sameHistoryAcrossCallsAndReload: true,
    errors: [...pageErrors, ...events.filter(e => ['app.error', 'error'].includes(e.type) && e.code !== 'response_cancel_not_active').map(e => e.error)],
  };
  writeFileSync('artifacts/voice-browser-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ready && report.audioOutput && report.userTranscript, true);
  assert.deepEqual(report.errors, []);
} finally { await browser.close(); }
