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
    window.nativePresentation = { expanded: localStorage.getItem('overlay-restore-collapsed') !== 'true', dock: 'right' };
    window.ZaizaiAssistant = {
      syncPresentation() {
        window.dispatchEvent(new CustomEvent('assistant-dock', { detail: window.nativePresentation.dock }));
        window.dispatchEvent(new CustomEvent('assistant-visibility', { detail: window.nativePresentation.expanded ? 'open' : 'collapsed' }));
      },
      collapse() {
        window.nativeActions.push('collapse');
        window.nativePresentation.expanded = false;
        window.dispatchEvent(new CustomEvent('assistant-visibility', { detail: 'collapsed' }));
      },
      expand() {
        window.nativeActions.push('expand');
        window.nativePresentation.expanded = true;
        window.dispatchEvent(new CustomEvent('assistant-visibility', { detail: 'open' }));
      },
      stop() { window.nativeActions.push('stop'); },
      openMain(action) { window.nativeActions.push(['openMain', action]); },
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
  assert.equal(await page.locator('.assistant-backdrop').count(), 0, 'Native conversation itself stays clear; frost belongs to the main app');
  const input = page.getByRole('textbox', { name: '发送给助手的消息', exact: true });
  await input.fill('键盘避让测试');
  await page.setViewportSize({ width: 320, height: 240 });
  const composer = await page.locator('.composer').boundingBox();
  assert.ok(composer.y >= 0 && composer.y + composer.height <= 240, 'Composer fits the reduced WebView above the keyboard');
  assert.equal(await input.inputValue(), '键盘避让测试', 'Resizing keeps the input draft');
  await page.setViewportSize({ width: 320, height: 480 });
  await input.fill('');
  await page.getByRole('button', { name: '拍照识别小票', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: '小票识别', exact: true });
  await receipt.waitFor();
  const capture = page.waitForEvent('filechooser');
  await receipt.getByRole('button', { name: '拍照', exact: true }).click();
  assert.equal(await (await capture).element().getAttribute('capture'), 'environment');
  const album = page.waitForEvent('filechooser');
  await receipt.getByRole('button', { name: '从相册选择', exact: true }).click();
  assert.equal(await (await album).element().getAttribute('capture'), null);
  await receipt.getByRole('button', { name: '关闭', exact: true }).click();
  for (const [id, label] of [['ledger', '记账'], ['tasks', '待办'], ['health', '健康'], ['mine', '我的']]) {
    await page.getByRole('button', { name: '添加记录', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '添加', exact: true });
    assert.deepEqual(await menu.locator('.add-menu-options button').allTextContents(), ['记账', '待办', '健康', '我的']);
    await menu.getByRole('button', { name: label, exact: true }).click();
    assert.ok(await page.evaluate(id => window.nativeActions.some(action => action[0] === 'openMain' && action[1] === id), id),
      'Overlay entry must open the selected main-app page');
    assert.equal(await page.locator('.modal').count(), 0);
  }
  await page.evaluate(() => { window.originalPanel = document.querySelector('.assistant-panel'); });
  await page.getByRole('button', { name: '收起助手', exact: true }).click();
  assert.ok(await page.evaluate(() => window.nativeActions.includes('collapse')));
  await page.setViewportSize({ width: 63, height: 63 });
  await page.waitForFunction(() => !document.querySelector('.assistant-panel')?.checkVisibility());
  const edge = page.getByRole('button', { name: '展开助手', exact: true });
  await edge.waitFor();
  assert.equal(await page.locator('.native-assistant-host').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)',
    'The cat must not have an opaque app background');
  for (const dock of ['right', 'left']) {
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('assistant-dock', { detail: value })), dock);
    await page.waitForFunction(value => document.querySelector('.assistant-edge')?.classList.contains(`dock-${value}`), dock);
    await edge.locator('img').evaluate(image => image.decode());
    assert.match(await edge.locator('img').getAttribute('src'), /assistant-gifs\/new-cat-/);
    const bounds = await edge.locator('img').boundingBox();
    assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 64 && bounds.y + bounds.height <= 64,
      'The whole rotated cat must remain inside the native window');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/native-cat-${dock}.png`, omitBackground: true });
  }
  await edge.click();
  await page.setViewportSize({ width: 320, height: 480 });
  await page.getByText('已有聊天记录', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.originalPanel === document.querySelector('.assistant-panel')), true,
    'Minimize/reopen must preserve the mounted conversation');
  assert.ok(await page.evaluate(() => window.nativeActions.includes('expand')));
  assert.equal(await page.getByRole('button', { name: '关闭助手', exact: true }).count(), 0);
  await page.getByRole('button', { name: '发起语音通话', exact: true }).click();
  await page.getByText('需要允许麦克风权限才能通话', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.nativeActions.includes('prepare')));
  assert.equal(await page.locator('.assistant-call-controls').count(), 0);
  await page.evaluate(() => localStorage.setItem('overlay-restore-collapsed', 'true'));
  await page.setViewportSize({ width: 63, height: 63 });
  await page.reload();
  await edge.waitFor();
  assert.equal(await page.getByRole('dialog', { name: '助手对话' }).isVisible(), false,
    'The initial native restore state must be synchronized after the page loads');
  assert.deepEqual(errors, []);
  console.log('PASS: native-host surface, minimize to animated cat on either edge, reopen history, isolated session and microphone-denial handshake. Native OS behavior still requires a device.');
} finally { await browser.close(); }
