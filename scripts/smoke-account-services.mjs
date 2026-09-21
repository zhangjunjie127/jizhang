import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { checkSettings } from './settings-checks.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'zaizai-account-test-'));
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;
let child, browser, token;
async function api(path, body, auth = token, expected = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, result.error || path);
  return result;
}
try {
  child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    DATA_DIR: directory, INVITE_CODE: 'account-fixture', CPA_API_KEY: '', CPA_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.stdout.on('data', data => { if (data.toString().includes('Zaizai server:')) { clearTimeout(timer); done(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited')); });
  });
  const account = { username: 'account-fixture', name: '测试用户', birthday: '2000-01-01', password: 'initial-password-123', invite: 'account-fixture' };
  const registered = await api('/register', account, '');
  token = registered.token;
  const otherSession = (await api('/login', { username: account.username, password: account.password }, '')).token;
  const otherUser = (await api('/register', { ...account, username: 'another-fixture' }, '')).token;
  await api('/feedback', undefined, '', 401);
  await api('/account/password', { currentPassword: account.password }, '', 401);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('zaizai-token', value), token);
  await page.goto(base);
  await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '账号设置', exact: true }).click();
  await page.getByRole('dialog', { name: '账号设置', exact: true }).waitFor();
  assert.equal(await page.locator('.account-id').textContent(), registered.user.id);
  await page.getByRole('button', { name: /^昵称/ }).click();
  const nameDialog = page.getByRole('dialog', { name: '修改昵称', exact: true });
  await nameDialog.waitFor();
  assert.equal(await page.locator('.account-settings-modal > .modal-heading h2').textContent(), '账号设置');
  await page.getByLabel('昵称', { exact: true }).fill('取消不保存');
  await nameDialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/state')).user.name, account.name);
  await page.getByRole('button', { name: /^昵称/ }).click();
  await page.getByLabel('昵称', { exact: true }).fill('   ');
  assert.equal(await nameDialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await page.getByLabel('昵称', { exact: true }).fill('测试新昵称');
  let nameFail = true;
  await page.route('**/api/account/profile', async route => {
    if (route.request().postDataJSON()?.name !== undefined && nameFail) {
      nameFail = false;
      return route.fulfill({ status: 503, json: { error: '昵称保存测试失败' } });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await nameDialog.getByRole('alert').filter({ hasText: '昵称保存测试失败' }).waitFor();
  assert.equal(await page.getByLabel('昵称', { exact: true }).inputValue(), '测试新昵称');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await nameDialog.waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '账号设置', exact: true }).waitFor();
  assert.equal((await api('/state')).user.name, '测试新昵称');
  await page.getByRole('button', { name: /^性别/ }).click();
  const genderSheet = page.getByRole('dialog', { name: '选择性别', exact: true });
  await genderSheet.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/state')).user.gender, '');
  await page.getByRole('button', { name: /^性别/ }).click();
  let genderFail = true;
  await page.route('**/api/account/profile', async route => {
    if (route.request().postDataJSON()?.gender !== undefined && genderFail) {
      genderFail = false;
      return route.fulfill({ status: 503, json: { error: '性别保存测试失败' } });
    }
    return route.continue();
  });
  await genderSheet.getByRole('button', { name: '女', exact: true }).click();
  await genderSheet.getByRole('alert').filter({ hasText: '性别保存测试失败' }).waitFor();
  assert.equal((await api('/state')).user.gender, '');
  await genderSheet.getByRole('button', { name: '女', exact: true }).click();
  await genderSheet.waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '账号设置', exact: true }).waitFor();
  assert.equal((await api('/state')).user.gender, 'female');
  assert.equal((await api('/state', undefined, otherUser)).user.gender, '');
  await api('/account/profile', { name: '未登录修改' }, '', 401, 'PATCH');
  await api('/account/profile', { id: registered.user.id, name: '禁止指定ID' }, otherUser, 400, 'PATCH');
  await page.getByRole('button', { name: '头像', exact: true }).click();
  await page.getByLabel('选择头像图片').setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await page.getByRole('alert').filter({ hasText: '图片无法读取' }).waitFor();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0089ff'; ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#fff'; ctx.fillRect(120, 40, 160, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('选择头像图片').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.locator('.account-avatar-preview img').waitFor();
  assert.equal((await api('/state')).user.avatar, '', 'Image selection does not save without confirmation');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '更换头像', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '账号设置', exact: true }).waitFor();
  assert.match((await api('/state')).user.avatar, /^data:image\/jpeg;base64,/);
  assert.equal((await api('/state', undefined, otherUser)).user.avatar, '');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.mine-avatar img').waitFor();
  await page.reload();
  await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('heading', { name: '测试新昵称', exact: true }).waitFor();
  assert.ok(await page.locator('.mine-avatar img').evaluate(img => img.complete && img.naturalWidth === 256 && img.naturalHeight === 256));
  assert.equal(await page.getByRole('button', { name: '账户安全中心', exact: true }).count(), 0);
  await page.getByRole('button', { name: '账号设置', exact: true }).click();
  await page.getByRole('button', { name: '密码设置', exact: true }).click();
  await page.getByLabel('当前密码', { exact: true }).fill('wrong-password');
  await page.getByLabel('新密码', { exact: true }).fill('updated-password-456');
  await page.getByLabel('确认新密码', { exact: true }).fill('updated-password-789');
  await page.getByRole('button', { name: '确认修改密码' }).click();
  await page.getByRole('alert').filter({ hasText: '两次新密码不一致' }).waitFor();
  await page.getByLabel('确认新密码', { exact: true }).fill('updated-password-456');
  await page.getByRole('button', { name: '确认修改密码' }).click();
  await page.getByRole('alert').filter({ hasText: '当前密码不正确' }).waitFor();
  await page.getByLabel('当前密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '确认修改密码' }).click();
  await page.getByRole('status').filter({ hasText: '密码已修改' }).waitFor();
  assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), '');
  await api('/state', undefined, otherSession, 401);
  await api('/state');
  await api('/state', undefined, otherUser);
  await api('/login', { username: account.username, password: account.password }, '', 401);
  await api('/login', { username: account.username, password: 'updated-password-456' }, '');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '意见反馈', exact: true }).click();
  await page.getByLabel('反馈内容', { exact: true }).fill('希望增加账单统计对比功能');
  await page.getByLabel('联系方式（选填）').fill('fixture@example.test');
  let failOnce = true;
  await page.route('**/api/feedback', async route => {
    if (route.request().method() === 'POST' && failOnce) {
      failOnce = false;
      return route.fulfill({ status: 503, json: { error: '测试临时网络故障' } });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试临时网络故障' }).waitFor();
  await page.screenshot({ path: 'artifacts/feedback-retry-390.png' });
  assert.equal(await page.getByLabel('反馈内容', { exact: true }).inputValue(), '希望增加账单统计对比功能');
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '反馈已保存' }).waitFor();
  assert.equal((await api('/feedback')).items.length, 1);
  assert.equal((await api('/feedback', undefined, otherUser)).items.length, 0);
  await page.getByRole('region', { name: '我的反馈' }).getByText('希望增加账单统计对比功能', { exact: true }).waitFor();
  const db = new DatabaseSync(join(directory, 'app.sqlite'));
  assert.equal(db.prepare('SELECT content FROM feedback').get().content, '希望增加账单统计对比功能');
  db.close();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => history.replaceState(null, '', '?preview=phone'));
    await page.getByRole('button', { name: '账号设置', exact: true }).click();
    const accountDialog = page.getByRole('dialog', { name: '账号设置', exact: true });
    await accountDialog.waitFor();
    await page.getByRole('button', { name: /^昵称/ }).click();
    await nameDialog.waitFor();
    const keyboard = page.getByRole('region', { name: '文字键盘', exact: true });
    await keyboard.waitFor();
    await page.getByLabel('昵称', { exact: true }).fill('取消测试');
    await keyboard.getByRole('button', { name: 'q', exact: true }).click();
    assert.equal(await page.getByLabel('昵称', { exact: true }).inputValue(), '取消测试q');
    const nameBox = await nameDialog.boundingBox();
    const keyBox = await keyboard.boundingBox();
    assert.ok(nameBox.height < 260 && nameBox.x >= 0 && nameBox.x + nameBox.width <= width);
    assert.ok(keyBox.y - nameBox.y - nameBox.height >= 0 && keyBox.y - nameBox.y - nameBox.height <= 16, 'Nickname popup sits just above keyboard');
    await page.screenshot({ path: `artifacts/account-nickname-${width}.png` });
    await nameDialog.getByRole('button', { name: '取消', exact: true }).click();
    await keyboard.waitFor({ state: 'hidden' });
    assert.equal((await api('/state')).user.name, '测试新昵称');
    assert.equal(await accountDialog.getByRole('button', { name: '密码设置', exact: true }).count(), 1);
    await page.getByRole('button', { name: /^性别/ }).click();
    await genderSheet.waitFor();
    assert.equal(await page.locator('.account-settings-modal > .modal-heading h2').textContent(), '账号设置');
    assert.equal(await genderSheet.getByRole('button', { name: '女', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `artifacts/account-gender-${width}.png` });
    await genderSheet.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await accountDialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    const alignment = await page.locator('.account-settings-row').evaluateAll(rows => {
      const close = values => Math.max(...values) - Math.min(...values) < 1;
      const labels = rows.map(row => row.firstElementChild.getBoundingClientRect());
      const values = rows.map(row => row.querySelector('.account-id,.account-settings-value,.account-settings-avatar')).filter(Boolean).map(node => node.getBoundingClientRect());
      const arrows = rows.map(row => row.querySelector('svg')).filter(Boolean).map(node => node.getBoundingClientRect());
      return close(labels.map(box => box.left)) && close(values.map(box => box.right)) && close(arrows.map(box => box.right)) &&
        rows.every(row => {
          const box = row.getBoundingClientRect();
          return [...row.children].every(node => { const item = node.getBoundingClientRect(); return Math.abs((item.top + item.bottom) / 2 - (box.top + box.bottom - 1) / 2) < 1; });
        });
    });
    assert.equal(alignment, true, 'Account labels/values/arrows share columns and are vertically centered');
    await page.screenshot({ path: `artifacts/account-settings-${width}.png` });
    for (const binding of ['手机号绑定', '微信绑定', '邮箱绑定']) {
      await page.getByRole('button', { name: new RegExp(`^${binding}`) }).click();
      await page.getByRole('heading', { name: '暂未开通', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').locator('input').count(), 0, 'No pretend binding input');
      await page.getByRole('button', { name: '返回账号设置', exact: true }).click();
    }
    await page.getByRole('button', { name: '头像', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '更换头像', exact: true });
    await sheet.waitFor();
    assert.equal(await page.locator('.account-settings-modal > .modal-heading h2').textContent(), '账号设置', 'Avatar opens over the existing settings page');
    assert.equal(await page.getByLabel('拍摄头像').getAttribute('capture'), 'user');
    const chooserEvent = page.waitForEvent('filechooser');
    await sheet.getByRole('button', { name: '拍照', exact: true }).click();
    const chooser = await chooserEvent;
    assert.equal(await chooser.element().getAttribute('aria-label'), '拍摄头像');
    const albumEvent = page.waitForEvent('filechooser');
    await sheet.getByRole('button', { name: '从相册选择', exact: true }).click();
    assert.equal(await (await albumEvent).element().getAttribute('aria-label'), '选择头像图片');
    const bounds = await sheet.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 844);
    await page.screenshot({ path: `artifacts/account-avatar-${width}.png` });
    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '头像', exact: true }).click();
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    await accountDialog.waitFor();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    for (const label of ['使用帮助', '意见反馈', '版本号']) {
      await page.getByRole('button', { name: label, exact: label !== '版本号' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      if (label === '使用帮助') {
        await page.getByText('如何记一笔账？', { exact: true }).click();
        await page.locator('details[open]').waitFor();
      }
      if (label === '意见反馈') await page.getByRole('region', { name: '我的反馈' }).getByText('希望增加账单统计对比功能', { exact: true }).waitFor();
      if (label === '版本号') await page.getByText('版本 0.1.0 · 邀请制内测', { exact: true }).waitFor();
      assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `${label}: no horizontal overflow`);
      await page.screenshot({ path: `artifacts/account-${label}-${width}.png` });
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
  await checkSettings(page, api, registered.user.id);
  await page.getByRole('button', { name: '账号设置', exact: true }).click();
  await page.getByRole('button', { name: '头像', exact: true }).click();
  await page.getByLabel('选择头像图片').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.locator('.account-avatar-preview img').waitFor();
  await page.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '更换头像', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '账号设置', exact: true }).waitFor();
  assert.equal((await api('/state')).user.avatar, '');
  for (const provider of ['phone', 'wechat', 'email']) await api(`/account/bindings/${provider}`, { value: 'fixture' }, token, 503);
  await page.getByRole('button', { name: /^申请注销/ }).click();
  await page.getByLabel('注销验证密码').fill('wrong-password');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal((await api('/account/deletion')).application, null, 'First step does not submit');
  await page.getByRole('button', { name: '确认提交注销申请', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '当前密码不正确' }).waitFor();
  await page.getByLabel('注销验证密码').fill('updated-password-456');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '确认提交注销申请', exact: true }).click();
  await page.getByRole('heading', { name: '注销申请待审核' }).waitFor();
  await page.screenshot({ path: 'artifacts/account-deletion-pending.png' });
  assert.equal((await api('/account/deletion')).application.status, 'pending');
  assert.equal((await api('/account/deletion', undefined, otherUser)).application, null);
  await api('/state');
  await page.getByRole('button', { name: '撤回注销申请' }).click();
  await page.getByRole('status').filter({ hasText: '上一份申请已撤回' }).waitFor();
  assert.equal((await api('/account/deletion')).application.status, 'cancelled');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '确认退出登录', exact: true }).click();
  await page.waitForFunction(() => !localStorage.getItem('zaizai-token'));
  await api('/state', undefined, token, 401);
  assert.deepEqual(errors, []);
  console.log('PASS: isolated real API + UI: account settings, nickname/gender/avatar persistence and isolation, password/session revocation, confirmed logout, feedback/help/version, 320/390/430 layouts. No live account data modified.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(target.split(/[\\/]/).at(-1).startsWith('zaizai-account-test-'));
  rmSync(target, { recursive: true, force: true });
}
