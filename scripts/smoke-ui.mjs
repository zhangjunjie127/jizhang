import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
assert(process.env.TEST_USERNAME && process.env.TEST_PASSWORD, 'Set TEST_USERNAME and TEST_PASSWORD.');
const credentials = { username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD };
async function api(path, body, token, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
let account = await api('/register', {
  ...credentials, name: '小林', birthday: '2000-01-01', invite: process.env.INVITE_CODE,
});
if (account.status === 409) account = await api('/login', credentials);
assert.equal(account.status, 200);
const { token } = account.data;
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
if (!account.data.records.length) {
  const samples = [
    ['task', { title: '把周五要交的材料整理好', due: `${day}T15:00:00+08:00` }],
    ['task', { title: '晚饭后，出门走 20 分钟', due: `${day}T19:30:00+08:00` }],
    ['task', { title: '给自己留一点不看手机的时间' }],
    ['expense', { title: '午饭', amount: 28, category: '餐饮' }],
    ['expense', { title: '通勤地铁', amount: 6, category: '交通' }],
    ['weight', { kg: 65.2, date: '2026-09-14' }],
    ['weight', { kg: 65.4, date: '2026-09-15' }],
    ['weight', { kg: 65.1, date: '2026-09-16' }],
  ];
  for (const [kind, payload] of samples) {
    const proposed = await api('/records', { kind, payload }, token);
    assert.equal(proposed.status, 201);
    assert.equal((await api(`/records/${proposed.data.proposed.id}/confirm`, {}, token)).status, 200);
  }
}
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: '已有账号' }).click();
  await page.getByLabel('账号', { exact: true }).fill(credentials.username);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '回到在在' }).click();
  await page.getByRole('heading', { name: '记账', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.sidebar nav button>span').allTextContents(), ['记账', '待办', '健康', '助手']);
  await page.screenshot({ path: 'artifacts/navigation-ledger-desktop.png', fullPage: true });
  await page.locator('.sidebar nav').getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  assert.equal(await page.getByLabel('金额（元）', { exact: true }).count(), 0);
  await page.getByLabel('要做的事', { exact: true }).fill('界面测试：整理明天的安排');
  await page.screenshot({ path: 'artifacts/confirmation-desktop.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已确认保存', { exact: true }).waitFor();
  await page.locator('.sidebar nav').getByRole('button', { name: '助手', exact: true }).click();
  await page.screenshot({ path: 'artifacts/chat-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await page.locator('.mobile-nav button>span').allTextContents(), ['记账', '待办', '健康', '助手']);
  assert.equal(await page.locator('.mobile-nav>button').nth(2).getAttribute('class'), 'nav-create');
  const createBox = await page.locator('.nav-create').boundingBox();
  assert.ok(Math.abs(createBox.x + createBox.width / 2 - 195) < 1, 'Create button centered');
  await page.locator('.nav-create').click();
  await page.getByRole('heading', { name: '添加', exact: true }).waitFor();
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByRole('button', { name: '午餐', exact: true }).click();
  await page.getByLabel('金额（元）', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10000 });
  for (const [view, file] of [['助手', 'chat'], ['待办', 'tasks'], ['记账', 'ledger'], ['健康', 'health']]) {
    await page.locator('.mobile-nav').getByRole('button', { name: view, exact: true }).click();
    await page.screenshot({ path: `artifacts/navigation-${file}-mobile.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow on ${view}`);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '我们记得的事', exact: false }).waitFor();
    await page.screenshot({ path: 'artifacts/navigation-settings-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(await page.locator('.mobile-nav').getByRole('button', { name: view, exact: true }).getAttribute('aria-current'), 'page');
  }
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  await page.screenshot({ path: 'artifacts/ledger-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('button', { name: '支出', exact: true }).click();
  await page.getByRole('button', { name: '交通', exact: true }).click();
  assert.match(await page.getByRole('button', { name: '更换类别' }).textContent(), /交通/);
  assert.equal(await page.getByLabel('要做的事', { exact: true }).count(), 0);
  await page.screenshot({ path: 'artifacts/navigation-entry-mobile.png' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: '健康', exact: true }).click();
  await page.screenshot({ path: 'artifacts/weight-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Overflow at 320px');
  await page.screenshot({ path: 'artifacts/weight-small-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '记录体重', exact: true }).click();
  assert.equal(await page.getByLabel('金额（元）', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('zaizai-page', 'health'));
  await page.reload();
  await page.getByRole('heading', { name: '记账', exact: true }).waitFor();
  await page.locator('.mobile-nav').getByRole('button', { name: '助手', exact: true }).click();
  await page.screenshot({ path: 'artifacts/navigation-chat-small-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Chat overflow at 320px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: 'passed', desktop: '1366x900', mobile: ['390x844', '320x740'], account: credentials.username, screenshots: 'artifacts/', errors }, null, 2));
} finally { await browser.close(); }
