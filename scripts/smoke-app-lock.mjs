import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'zaizai-lock-test-'));
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;
let child, browser, token;
async function api(path, body, auth = token, status = 200) {
  const response = await fetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth || ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, status, result.error);
  return result;
}
try {
  child = spawn(process.execPath, ['server/index.mjs'], { windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, INVITE_CODE: 'lock-fixture', CPA_API_KEY: '', CPA_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 10000);
    child.stdout.on('data', data => { if (String(data).includes('Zaizai server:')) { clearTimeout(timer); done(); } });
    child.once('error', reject);
  });
  const account = { username: 'lock-fixture', name: '锁屏测试', birthday: '2000-01-01', password: 'lock-test-password-123', invite: 'lock-fixture' };
  const result = await api('/register', account, '');
  token = result.token;
  const key = `zaizai-app-lock-${result.user.id}`;
  const other = await api('/register', { ...account, username: 'lock-other' }, '');
  await api('/records', { kind: 'expense', confirmed: true, payload: { title: '锁屏不能显示这条账目', category: '早餐', amount: '88', direction: 'expense', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) } }, token, 201);
  await api('/account/app-lock/verify', { currentPassword: account.password }, '', 401);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(value => localStorage.setItem('zaizai-token', value), token);
  await page.reload();
  const locked = page.getByRole('main', { name: '应用已锁定' });
  const close = () => page.getByRole('button', { name: '关闭', exact: true }).click();
  async function settings() {
    await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.locator('.mine-menu').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /^应用锁/ }).click();
  }
  async function pin(value) {
    for (const digit of value) await page.getByRole('group', { name: '六位解锁密码', exact: true }).getByRole('button', { name: digit, exact: true }).click();
  }
  async function gesture() {
    const box = await page.getByRole('group', { name: '九宫格手势' }).boundingBox();
    const at = point => ({ x: box.x + (point % 3 + .5) * box.width / 3, y: box.y + (Math.floor(point / 3) + .5) * box.height / 3 });
    const start = at(0);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (const point of [1, 2, 5]) { const next = at(point); await page.mouse.move(next.x, next.y, { steps: 5 }); }
    await page.mouse.up();
  }
  await settings();
  assert.deepEqual(await page.locator('.lock-settings .preferences-row small').allTextContents(), ['设置', '设置', '设置']);
  assert.equal(await page.getByRole('button', { name: /^人脸识别/ }).isDisabled(), true, 'No fake web face verification');
  await page.getByRole('button', { name: /^密码解锁/ }).click();
  mkdirSync('artifacts', { recursive: true });
  assert.equal(await page.locator('.lock-pin-slots>span').count(), 6);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const boxes = await page.locator('.lock-pin-slots>span').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, right: rect.right }; }));
    assert.ok(boxes.every(box => box.x >= 0 && box.right <= width && Math.abs(box.y - boxes[0].y) < 1 && Math.abs(box.width - boxes[0].width) < 1));
    await page.screenshot({ path: `artifacts/app-lock-six-slots-${width}.png` });
  }
  await pin('135790');
  assert.equal(await page.locator('.lock-pin-slots i').count(), 6);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null, 'First entry never enables lock');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('heading', { name: '再次输入以确认', exact: true }).waitFor();
  assert.equal(await page.locator('.lock-pin-slots i').count(), 0);
  await pin('135791');
  await page.getByLabel('账号登录密码').fill(account.password);
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '两次输入不一致' }).waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
  await pin('135790');
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await page.getByText('已开启 · 打开或返回时验证', { exact: true }).waitFor();
  const saved = await page.evaluate(key => localStorage.getItem(key), key);
  assert.ok(!saved.includes('135790') && !saved.includes(account.password));
  await page.getByRole('button', { name: /^手势解锁/ }).click();
  await gesture();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await gesture();
  await page.getByLabel('账号登录密码').fill(account.password);
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await page.getByRole('button', { name: '立即锁定', exact: true }).click();
  await locked.waitFor();
  assert.equal(await page.locator('.mobile-nav').count(), 0);
  assert.equal(await page.getByText('锁屏不能显示这条账目', { exact: true }).count(), 0);
  for (let count = 1; count <= 5; count++) {
    await pin('999999');
    await page.getByRole('button', { name: '解锁', exact: true }).click();
    await page.waitForFunction(({ key, count }) => {
      const value = JSON.parse(localStorage.getItem(key));
      return count === 5 ? value.blockedUntil > Date.now() : value.failures === count;
    }, { key, count });
    await page.waitForFunction(() => document.querySelector('input[aria-label="应用锁密码"]').value === '');
  }
  await page.reload();
  await locked.waitFor();
  assert.equal(await page.getByRole('group', { name: '六位解锁密码' }).getByRole('button', { name: '1', exact: true }).isDisabled(), true);
  await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); value.blockedUntil = Date.now() - 1; localStorage.setItem(key, JSON.stringify(value)); }, key);
  await page.reload();
  await locked.waitFor();
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await locked.evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: `artifacts/app-lock-pin-${width}.png` });
  }
  await pin('135790');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await page.locator('.mobile-nav').waitFor();
  // Simulate the browser visibility event; Android lifecycle still requires device testing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await locked.waitFor();
  await page.getByRole('button', { name: '手势解锁', exact: true }).click();
  await gesture();
  await page.screenshot({ path: 'artifacts/app-lock-gesture.png' });
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await page.locator('.mobile-nav').waitFor();
  await page.reload();
  await locked.waitFor();
  await page.getByRole('button', { name: '忘记密码或手势？', exact: true }).click();
  await page.getByLabel('账号登录密码').fill('wrong-password');
  await page.getByRole('button', { name: '验证并重置应用锁', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '账号密码不正确' }).waitFor();
  assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)).enabled, true);
  await page.route('**/api/account/app-lock/verify', route => route.fulfill({ status: 503, json: { error: '测试断网' } }));
  await page.getByLabel('账号登录密码').fill(account.password);
  await page.getByRole('button', { name: '验证并重置应用锁', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试断网' }).waitFor();
  await locked.waitFor();
  await page.unroute('**/api/account/app-lock/verify');
  await page.getByRole('button', { name: '验证并重置应用锁', exact: true }).click();
  await page.locator('.mobile-nav').waitFor();
  assert.equal((await api('/state')).records.length, 1, 'Recovery retains records');
  await settings();
  await page.getByRole('button', { name: /^密码解锁/ }).click();
  await pin('246802'); await page.getByRole('button', { name: '下一步', exact: true }).click(); await pin('246802');
  await page.getByLabel('账号登录密码').fill(account.password);
  await page.getByRole('button', { name: '确认并启用', exact: true }).click();
  await page.getByRole('button', { name: '立即锁定', exact: true }).click();
  await locked.waitFor();
  await api('/account/app-lock/verify', { currentPassword: account.password }, token, 429);
  await page.evaluate(token => localStorage.setItem('zaizai-token', token), other.token);
  await page.reload();
  await page.locator('.mobile-nav').waitFor();
  assert.equal(await locked.count(), 0, 'Local app lock is account scoped');
  await page.evaluate(({ key, token }) => { localStorage.setItem('zaizai-token', token); localStorage.setItem(key, '{}'); }, { key, token });
  await page.reload();
  await locked.waitFor();
  await page.getByRole('heading', { name: '重置应用锁', exact: true }).waitFor();
  assert.equal(await page.locator('.mobile-nav').count(), 0, 'Corrupt settings fail closed');
  assert.deepEqual(errors, []);
  console.log('PASS: isolated PIN/gesture setup, mismatch, reload/background lock, hidden content, persistent cooldown, browser face unavailable, recovery password/offline/limits, account isolation, corrupt settings, and 320/390/430 layouts. No live data changed.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(target.split(/[\\/]/).at(-1).startsWith('zaizai-lock-test-'));
  rmSync(target, { recursive: true, force: true });
}
