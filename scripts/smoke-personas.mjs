import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { PERSONA_OPTIONS } from '../shared/personas.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'zaizai-persona-ui-'));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
    INVITE_CODE: 'persona-fixture', CPA_API_KEY: '', CPA_BASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser, page;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });
  const response = await fetch(`${base}/api/register`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      username: 'persona-ui', password: 'PersonaFixture123!', name: '人格测试',
      birthday: '2000-01-01', invite: 'persona-fixture',
    }) });
  assert.ok(response.ok);
  const { token } = await response.json();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ base, token }) => {
    localStorage.setItem('zaizai-server', base);
    localStorage.setItem('zaizai-token', token);
  }, { base, token });
  mkdirSync('artifacts/personas', { recursive: true });
  for (const [width, height] of [[390, 844], [320, 568], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:5173');
    await page.locator(width >= 1000 ? '.sidebar' : '.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '我的助手', exact: true }).click();
    await page.getByRole('button', { name: '切换助手性格' }).click();
    assert.equal(await page.locator('.persona-list>button').count(), 6);
    assert.equal(await page.locator('.persona-list').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ path: `artifacts/personas/chooser-${width}.png` });
    for (const config of Object.values(PERSONA_OPTIONS)) {
      await page.locator('.persona-list>button').filter({ hasText: config.name }).click();
      await page.locator('.persona-list').waitFor({ state: 'detached' });
      assert.ok((await page.getByRole('button', { name: '切换助手性格' }).textContent()).includes(config.name));
      await page.getByRole('button', { name: '切换助手性格' }).click();
    }
    await page.route('**/api/profile', route => route.fulfill({
      status: 409, contentType: 'application/json', body: JSON.stringify({ error: '通话期间不能切换助手' }),
    }));
    await page.locator('.persona-list>button').filter({ hasText: '阿衡' }).click();
    await page.getByRole('alert').filter({ hasText: '通话期间不能切换助手' }).waitFor();
    assert.equal(await page.locator('.persona-list>button:disabled').count(), 0);
    await page.unroute('**/api/profile');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: six choices, persistence, errors and responsive selector at 320/390/1280px.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'artifacts/personas/ui-failure.png' });
    console.error((await page.locator('body').innerText()).slice(0, 1200));
  }
  throw error;
} finally {
  await browser?.close();
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true });
}
