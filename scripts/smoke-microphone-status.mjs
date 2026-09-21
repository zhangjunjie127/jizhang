import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'mic-test', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
    records: [], memories: [], messages: [],
  } }));
  await page.addInitScript(() => {
    localStorage.setItem('zaizai-token', 'mic-fixture-only');
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      if (window.denyMicrophone) throw new DOMException('Permission denied', 'NotAllowedError');
      const stream = await nativeGetUserMedia(options);
      window.testTrack = stream.getAudioTracks()[0];
      window.hardwareMuted = false;
      Object.defineProperty(window.testTrack, 'muted', { get: () => window.hardwareMuted });
      return stream;
    };
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = class extends OriginalAudioContext {
      constructor(options) { super(options); window.testAudioContext = this; }
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1;
      constructor(url) {
        if (new URL(url).pathname !== '/voice') return new NativeWebSocket(url);
        window.voiceMock = this;
        window.voiceConnections = (window.voiceConnections || 0) + 1;
        this.readyState = 0;
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
      }
      send(event) { (window.sentEvents ||= []).push(JSON.parse(event)); }
      emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
      close() { this.readyState = 3; this.onclose?.(); }
    };
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  assert.equal(await page.getByRole('button', { name: '和助手通话', exact: true }).count(), 0);
  assert.equal(await page.locator('.module-actions .assistant-entry').count(), 0);
  await page.getByRole('button', { name: '展开助手', exact: true }).click({ position: { x: 12, y: 32 } });
  assert.equal(await page.evaluate(() => Boolean(window.testTrack)), false, 'Opening chat never captures audio');
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  const mic = page.locator('[data-microphone-state]');
  await mic.waitFor();
  assert.equal(await mic.getAttribute('data-microphone-state'), 'unavailable');
  assert.equal(await mic.isDisabled(), true);
  await page.waitForFunction(() => window.voiceMock?.readyState === 1);
  await page.evaluate(() => window.voiceMock.emit({ type: 'app.ready' }));
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]')?.dataset.microphoneState === 'active');
  assert.equal(await mic.evaluate(el => getComputedStyle(el).color), 'rgb(8, 126, 73)');
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/microphone-active.png' });
  await page.evaluate(() => window.voiceMock.emit({ type: 'app.message', message: { id: 'voice-history', user_id: 'mic-test', role: 'assistant', text: '同一段聊天记录', created: new Date().toISOString() } }));
  await page.getByRole('button', { name: '收起助手', exact: true }).click();
  assert.equal(await page.locator('.assistant-panel').count(), 0);
  assert.equal(await page.evaluate(() => window.testTrack.readyState), 'live');
  assert.equal(await page.evaluate(() => window.voiceMock.readyState), 1);
  await page.locator('.mobile-nav').getByRole('button', { name: '待办', exact: true }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  const edge = page.getByRole('button', { name: '展开通话助手', exact: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const edgeBox = await edge.boundingBox();
    assert.ok(Math.abs(width - edgeBox.x - 28) < 1, 'Only a 28px edge tab is exposed, not a floating ball');
    await page.screenshot({ path: `artifacts/assistant-edge-${width}.png` });
    await edge.click({ position: { x: 12, y: 32 } });
    const panel = await page.getByRole('dialog', { name: '助手对话' }).boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width && panel.height >= 210);
    await page.locator('[data-message-id="voice-history"]').waitFor();
    assert.equal(await page.evaluate(() => window.voiceConnections), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/assistant-panel-${width}.png` });
    await page.getByRole('button', { name: '收起助手', exact: true }).click();
  }
  const edgeBox = await edge.boundingBox();
  await page.mouse.move(edgeBox.x + 12, edgeBox.y + 32);
  await page.mouse.down();
  await page.mouse.move(10, 240, { steps: 10 });
  await page.mouse.up();
  assert.ok((await edge.boundingBox()).x < 0, 'Drag can dock the tab against the left edge');
  assert.equal(await page.locator('.assistant-panel').count(), 0, 'Dragging does not open the panel');
  await edge.click({ position: { x: 35, y: 32 } });
  await page.getByRole('textbox', { name: '发送给助手的消息' }).fill('通话内文字');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  assert.ok(await page.evaluate(() => window.sentEvents.some(event => event.type === 'app.text' && event.text === '通话内文字')));
  for (const type of ['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped']) {
    await page.evaluate(type => window.voiceMock.emit({ type }), type);
    assert.equal(await mic.getAttribute('data-microphone-state'), 'active');
  }
  await page.evaluate(() => window.voiceMock.emit({ type: 'response.output_audio.delta', item_id: 'test', delta: btoa('\0'.repeat(96000)) }));
  assert.equal(await mic.getAttribute('data-microphone-state'), 'active');
  await mic.click();
  assert.equal(await mic.getAttribute('data-microphone-state'), 'muted');
  assert.equal(await mic.evaluate(el => getComputedStyle(el).color), 'rgb(78, 98, 111)');
  assert.equal(await page.evaluate(() => window.testTrack.enabled), false);
  await page.screenshot({ path: 'artifacts/microphone-muted.png' });
  await mic.click();
  assert.equal(await mic.getAttribute('data-microphone-state'), 'active');
  await page.evaluate(() => { window.hardwareMuted = true; window.testTrack.dispatchEvent(new Event('mute')); });
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]').dataset.microphoneState === 'unavailable');
  await page.evaluate(() => { window.hardwareMuted = false; window.testTrack.dispatchEvent(new Event('unmute')); });
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]').dataset.microphoneState === 'active');
  await page.evaluate(() => window.testAudioContext.suspend());
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]').dataset.microphoneState === 'unavailable');
  await page.evaluate(() => window.testAudioContext.resume());
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]').dataset.microphoneState === 'active');
  await page.evaluate(() => { window.testTrack.stop(); window.testTrack.dispatchEvent(new Event('ended')); });
  await page.waitForFunction(() => document.querySelector('[data-microphone-state]').dataset.microphoneState === 'unavailable');
  await page.evaluate(() => window.voiceMock.close());
  await page.locator('.assistant-call-controls').waitFor({ state: 'hidden' });
  await page.evaluate(() => { window.denyMicrophone = true; });
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.getByText('需要允许麦克风权限才能通话', { exact: true }).waitFor();
  assert.equal(await page.locator('.mic-active').count(), 0);
  await page.evaluate(() => { window.denyMicrophone = false; });
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.waitForFunction(() => window.voiceConnections === 2 && window.voiceMock.readyState === 1);
  await page.evaluate(() => window.voiceMock.emit({ type: 'app.ready' }));
  await page.getByRole('button', { name: '结束通话', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testTrack.readyState), 'ended', 'Explicit hangup stops microphone');
  assert.equal(await page.evaluate(() => window.voiceMock.readyState), 3);
  await page.locator('[data-message-id="voice-history"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: green while listening/thinking/speaking; grey when muted, connecting, suspended or track unavailable; disconnect/permission cleanup. Fake microphone and mocked voice transport; no AI requests.');
} finally {
  await browser.close();
}
