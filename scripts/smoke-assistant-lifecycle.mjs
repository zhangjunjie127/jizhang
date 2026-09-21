import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createCredential, emptyLock } from '../src/app-lock-core.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const errors = [];
  async function fixture(lock) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/state', route => route.fulfill({ json: {
      user: { id: 'lifecycle-fixture', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
      records: [], messages: [], memories: [],
    } }));
    await page.addInitScript(lockData => {
      localStorage.setItem('zaizai-token', 'lifecycle-fixture-only');
      localStorage.setItem('zaizai-server', location.origin);
      window.androidBridge = {};
      window.nativeCalls = [];
      window.overlayState = { permitted: false, running: false, dismissed: false, created: 0 };
      window.nativeListeners = {};
      window.emitNative = name => window.nativeListeners[name]?.({});
      window.Capacitor = {
        PluginHeaders: [
          { name: 'FloatingAssistant', methods: ['show', 'status', 'stop', 'requestOverlayPermission', 'removeListener'].map(name => ({ name, rtype: 'promise' })).concat([{ name: 'addListener', rtype: 'callback' }]) },
          { name: 'AppLock', methods: ['read', 'write', 'availability', 'removeListener'].map(name => ({ name, rtype: 'promise' })).concat([{ name: 'addListener', rtype: 'callback' }]) },
          { name: 'LocalNotifications', methods: [{ name: 'checkPermissions', rtype: 'promise' }] },
        ],
        nativeCallback(plugin, method, options, callback) {
          window.nativeListeners[`${plugin}:${options.eventName}`] = callback;
          return Promise.resolve(`${plugin}:${options.eventName}`);
        },
        async nativePromise(plugin, method, options) {
          window.nativeCalls.push({ plugin, method, options });
          if (method === 'removeListener') { delete window.nativeListeners[options.callbackId]; return; }
          if (plugin === 'AppLock') {
            if (method === 'read') return { data: lockData ? JSON.stringify(lockData) : null };
            if (method === 'write') { lockData = JSON.parse(options.data); return; }
            if (method === 'availability') return { available: false };
          }
          if (plugin === 'LocalNotifications') return { display: 'denied' };
          if (plugin === 'FloatingAssistant') {
            const state = window.overlayState;
            if (method === 'status') return { ...state };
            if (method === 'stop') { state.running = false; state.dismissed = true; return; }
            if (method === 'show') {
              if (!state.permitted || (options.restore && state.dismissed)) return { running: false };
              if (!state.running) state.created++;
              state.running = true; state.dismissed = false;
              return { running: true };
            }
          }
        },
      };
    }, lock);
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    return page;
  }
  const page = await fixture(null);
  const edge = page.getByRole('button', { name: '展开助手', exact: true });
  await edge.waitFor();
  assert.equal(await page.evaluate(() => window.overlayState.created), 0);
  await edge.click({ position: { x: 12, y: 32 } });
  await page.waitForFunction(() => window.nativeCalls.some(call => call.method === 'requestOverlayPermission'));
  await page.evaluate(() => { window.overlayState.permitted = true; window.emitNative('FloatingAssistant:foreground'); });
  await page.waitForFunction(() => window.overlayState.running);
  await edge.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.emitNative('FloatingAssistant:foreground'));
  assert.equal(await page.evaluate(() => window.overlayState.created), 1, 'Returning reuses the existing service');
  await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '我的助手', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /^桌面悬浮助手/ }).click();
  await page.waitForFunction(() => !window.overlayState.running);
  await page.evaluate(() => window.emitNative('FloatingAssistant:foreground'));
  assert.equal(await page.evaluate(() => window.overlayState.created), 1, 'Explicit disable does not auto-restart');
  await edge.click({ position: { x: 12, y: 32 } });
  await page.waitForFunction(() => window.overlayState.created === 2);
  await page.evaluate(() => {
    window.overlayState.running = false; window.overlayState.dismissed = true;
    window.emitNative('FloatingAssistant:foreground');
  });
  await edge.waitFor();
  assert.equal(await page.evaluate(() => window.overlayState.created), 2, 'Native close is respected on foreground');
  await page.close();

  const locked = await fixture({ ...emptyLock(), enabled: true, pin: await createCredential('pin', '147258') });
  await locked.getByRole('group', { name: '六位解锁密码' }).waitFor();
  assert.equal(await locked.evaluate(() => window.nativeCalls.some(call => call.method === 'show')), false, 'No new overlay starts before app unlock');
  await locked.evaluate(() => { window.overlayState.permitted = true; });
  for (const digit of '147258') await locked.getByRole('button', { name: digit, exact: true }).click();
  await locked.getByRole('button', { name: '解锁', exact: true }).click();
  await locked.waitForFunction(() => window.overlayState.running);
  assert.equal(await locked.evaluate(() => window.nativeCalls.find(call => call.method === 'show').options.restore), true);
  assert.deepEqual(errors, []);
  console.log('PASS: mocked native lifecycle: first permission, collapsed restore, reuse, explicit stop, reopening and app-lock gate. No OS lifecycle claims.');
} finally { await browser.close(); }
