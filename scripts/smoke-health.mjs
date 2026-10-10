import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'zaizai-health-ui-'));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
let validFood = false, aiCalls = 0, validReport = true, reportCalls = 0;
const ai = http.createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  assert.equal(body.tools, undefined);
  assert.ok(body.messages[1].content.some(item => item.type === 'image_url'));
  if (body.messages[0].content.includes('仅抄录报告照片')) {
    reportCalls++;
    const kind = body.messages[0].content.includes('当前归档类型：视力') ? 'vision'
      : body.messages[0].content.includes('当前归档类型：就医') ? 'visit' : 'checkup';
    const draft = { date: '2026-10-01', institution: '报告识别医院',
      ...(kind === 'vision' ? { leftUnaided: '0.8', rightUnaided: '5.0', leftCorrected: '1.0', rightCorrected: '5.1',
        leftSphere: '-2.25', rightSphere: '+1.00', leftCylinder: '-0.50', rightCylinder: '', leftAxis: '90', rightAxis: '', pupillaryDistance: '63' }
        : kind === 'checkup' ? { items: '血常规', note: '原文备注' } : { department: '内科', reason: '复查', advice: '原文医嘱' }),
      name: '不应返回的姓名', followUp: '2099-10-20', user_id: 'not-owner' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ isReport: validReport, draft }) } }] }));
    return;
  }
  aiCalls++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validFood
    ? { isFood: true, items: [{ name: '拍照米饭', grams: 150, kcal: 195, protein: 4, fat: .4, carbs: 42 }], warnings: ['份量需核对'] }
    : { isFood: false, items: [] }) } }] }));
});
const aiPort = await listen(ai);
const probe = http.createServer();
const port = await listen(probe); await close(probe);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir, INVITE_CODE: 'health-ui',
    CPA_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, CPA_API_KEY: 'fixture-only' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let page;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Health server did not start')), 10000);
    server.stdout.on('data', chunk => { if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
  let token;
  const api = async (path, body, method = 'POST') => {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  };
  const account = await api('/register', { username: 'health-ui', password: 'HealthUiTest123!', name: '健康测试', birthday: '2000-01-01', invite: 'health-ui' });
  token = account.token;
  await api('/records', { kind: 'weight', confirmed: true, payload: { kg: 65, date: '2026-10-01' } });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ base, token }) => {
    localStorage.setItem('zaizai-server', base); localStorage.setItem('zaizai-token', token);
  }, { base, token });
  const go = async () => {
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.mobile-nav').getByRole('button', { name: '健康', exact: true }).click();
    await page.getByRole('button', { name: '添加早餐', exact: true }).waitFor();
  };
  await go();
  const dashboard = page.locator('.health-dashboard');
  assert.equal(await dashboard.getByLabel('健康记录日期', { exact: true }).count(), 0, 'Home has no date filter');
  await dashboard.getByRole('button', { name: '设备与数据同步', exact: true }).click();
  await page.getByRole('checkbox', { name: '步数', exact: true }).waitFor();
  assert.equal(await page.getByText('暂未接入', { exact: true }).count(), 3);
  assert.equal(await page.getByRole('button', { name: '立即同步', exact: true }).isDisabled(), true);
  await page.getByRole('checkbox', { name: '心率', exact: true }).uncheck();
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await page.getByText('同步偏好已保存到账号，尚未开启设备同步', { exact: true }).waitFor();
  assert.deepEqual((await api('/health/sync', null, 'GET')).metrics, ['steps', 'sleep', 'exercise', 'weight']);
  await go();
  await dashboard.getByRole('button', { name: '设备与数据同步', exact: true }).click();
  await page.getByRole('checkbox', { name: '心率', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '心率', exact: true }).isChecked(), false);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `artifacts/health-sync-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '返回健康首页', exact: true }).click();
  assert.equal(await dashboard.getByRole('navigation', { name: '健康视图' }).count(), 0);
  await dashboard.getByRole('button', { name: '打开生理周期', exact: true }).click();
  await page.getByRole('dialog', { name: '选择性别' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/state', null, 'GET')).user.gender, '');
  await page.getByRole('button', { name: '添加早餐', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索食物', exact: true }).fill('米饭');
  await page.locator('.health-food-search button').click();
  await page.getByLabel('重量（g）', { exact: true }).fill('200');
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await api('/health/dashboard', null, 'GET')).entries[0].items[0].kcal, 260);
  await page.getByRole('button', { name: '添加晚餐', exact: true }).click();
  await page.getByRole('button', { name: '手动填写', exact: true }).click();
  await page.getByLabel('食物名称', { exact: true }).fill('家常面条');
  await page.getByLabel('该份热量（千卡）', { exact: true }).fill('220');
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '打开喝水记录', exact: true }).click();
  await page.getByRole('button', { name: '添加饮水', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await page.getByRole('button', { name: '添加运动', exact: true }).click();
  await page.getByLabel('运动名称', { exact: true }).fill('散步');
  await page.getByLabel('设备或自填消耗（千卡，未知填 0）', { exact: true }).fill('120');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '健康目标设置', exact: true }).click();
  await page.getByLabel('身高（cm）', { exact: true }).fill('165');
  await page.getByLabel('自设每日饮食热量（千卡，可不填）', { exact: true }).fill('1800');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await dashboard.getByRole('button', { name: '打开生理周期', exact: true }).click();
  await page.getByLabel('性别', { exact: true }).selectOption('female');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '新增生理周期', exact: true }).click();
  await page.getByLabel('腹痛', { exact: true }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await dashboard.getByText('经期进行中', { exact: true }).waitFor();
  await page.getByRole('button', { name: '记录结束', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.ok((await api('/health/dashboard', null, 'GET')).entries.find(e => e.kind === 'period').end);
  await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await page.getByRole('button', { name: '拍照记录', exact: true }).click();
  const beforePhoto = (await api('/health/dashboard', null, 'GET')).entries.length;
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f99'; ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.health-photo input[type=file]').last().setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByAltText('待识别食物').waitFor();
  assert.equal(await page.getByRole('button', { name: '识别食物', exact: true }).isEnabled(), false);
  await page.locator('.health-consent input').check();
  await page.getByRole('button', { name: '识别食物', exact: true }).click();
  await page.getByText('未识别到清晰的食物，请换一张照片', { exact: true }).waitFor();
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.length, beforePhoto);
  validFood = true;
  await page.getByRole('button', { name: '识别食物', exact: true }).click();
  await page.getByLabel('食物名称', { exact: true }).waitFor();
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.length, beforePhoto);
  await page.getByLabel('该份热量（千卡）', { exact: true }).fill('200');
  await page.screenshot({ path: 'artifacts/health-photo-review.png' });
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.length, beforePhoto + 1);
  assert.equal(aiCalls, 2);
  await go();
  assert.equal(await page.locator('.health-food-summary strong').textContent(), '1,120');
  assert.equal(await page.locator('.health-tile.habit, .health-tile.checkup, .health-tile.visit').count(), 0);
  await api('/health/entries', { kind: 'habit', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), name: '拉伸', requestId: crypto.randomUUID() });
  for (const [label, title] of [['排便', '记录排便'], ['睡眠', '记录睡眠']]) {
    await page.locator('.health-tile').filter({ has: page.locator('strong', { hasText: label }) }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  }
  await go();
  const extraEntries = (await api('/health/dashboard', null, 'GET')).entries;
  for (const kind of ['bowel', 'sleep', 'habit']) assert.ok(extraEntries.some(e => e.kind === kind));
  for (const kind of ['checkup', 'visit']) {
    await page.locator('.health-tile.medical').click();
    await page.getByRole('tab', { name: kind === 'checkup' ? '体检' : '就医', exact: true }).click();
    await page.getByRole('button', { name: kind === 'checkup' ? '记录体检' : '记录就医', exact: true }).click();
    await page.getByLabel(kind === 'checkup' ? '体检机构' : '医院', { exact: true }).fill('健康测试医院');
    if (kind === 'checkup') {
      await page.getByLabel('检查项目', { exact: true }).fill('血常规、心电图');
    } else {
      await page.getByLabel('科室', { exact: true }).fill('内科');
      await page.getByLabel('就诊原因', { exact: true }).fill('复查');
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 740 });
      assert.equal(await page.locator('.health-editor').evaluate(el => el.scrollHeight > el.clientHeight + 2), false, `${kind} basic form fits ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    if (kind === 'visit') {
      await page.getByLabel('医嘱', { exact: true }).fill('按医生要求复诊');
      await page.getByLabel('复诊提醒时间（可不填）', { exact: true }).fill('2099-10-20T09:00');
    }
    await page.screenshot({ path: `artifacts/health-${kind}-editor.png` });
    assert.equal(await page.locator('.health-editor').evaluate(el => el.scrollHeight > el.clientHeight + 2), false, `${kind} notes fit`);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    if (kind === 'checkup') {
      await page.getByLabel('选择留档照片', { exact: true }).setInputFiles({ name: 'report.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.getByAltText('留档照片1', { exact: true }).waitFor();
    }
    assert.equal(await page.locator('.health-editor').evaluate(el => el.scrollHeight > el.clientHeight + 2), false, `${kind} photos fit`);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: `编辑${kind === 'checkup' ? '体检' : '就医'} · 健康测试医院`, exact: true }).click();
    if (kind === 'checkup') {
      assert.equal(await page.getByRole('textbox', { name: /^检查项目/ }).inputValue(), '血常规、心电图');
    }
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    if (kind === 'visit') {
      await page.getByRole('textbox', { name: /^医嘱/ }).fill('已核对复诊日期');
    }
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    assert.equal(await page.getByLabel(kind === 'checkup' ? '体检机构' : '医院', { exact: true }).inputValue(), '健康测试医院');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    if (kind === 'checkup') await page.getByAltText('留档照片1', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  }
  const reminders = await api('/health/reminders', null, 'GET');
  assert.equal(reminders.entries.length, 1);
  assert.equal(reminders.entries[0].reason, undefined);
  await go();
  for (const [label, editLabel, deleteLabel] of [['排便', '编辑排便 · 成形', '删除排便 · 成形'], ['睡眠', '编辑睡眠 · 一般', '删除睡眠 · 一般']]) {
    await page.locator('.health-tile').filter({ has: page.locator('strong', { hasText: label }) }).click();
    await page.getByRole('button', { name: editLabel, exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: deleteLabel, exact: true }).count(), 1);
    await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  }
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const header = page.locator('.health-fixed-header');
    const before = await header.boundingBox();
    const contentBefore = await page.locator('.health-weight-band').boundingBox();
    await page.evaluate(() => window.scrollTo(0, 250));
    const after = await header.boundingBox();
    const contentAfter = await page.locator('.health-weight-band').boundingBox();
    assert.ok(Math.abs(after.y) < 1, `Health header sticks at ${width}px`);
    assert.ok(Math.abs(after.height - before.height) < 1, 'Sticky header keeps its height');
    assert.ok(contentAfter.y < contentBefore.y - 100, 'Health content scrolls below header');
    await page.screenshot({ path: `artifacts/health-sticky-${width}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/health-home-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Health fits ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看健康记录', exact: true }).click();
  await page.getByRole('button', { name: '编辑拉伸', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '删除拉伸', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.some(e => e.kind === 'habit'), false);
  await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
  await page.getByRole('dialog', { name: '添加健康记录' }).waitFor();
  assert.equal(await page.locator('.health-add-menu button').count(), 8);
  assert.equal(await page.locator('.health-add-menu').getByRole('button', { name: '健康习惯', exact: true }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).count().then(async count => {
    if (count) await page.getByRole('button', { name: '取消', exact: true }).click();
    else await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  });
  for (const [kind, title] of [
    ['weight', '记录体重'], ['water', '记录饮水'], ['period', '记录生理周期'],
    ['bowel', '记录排便'], ['sleep', '记录睡眠'],
  ]) {
    await page.locator(`.health-tile.${kind}`).click();
    await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
    await page.getByRole('dialog', { name: title, exact: true }).waitFor();
    assert.equal(await page.locator('.health-add-menu').count(), 0, `${kind} opens directly`);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  }
  await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
  await page.locator('.health-add-menu').getByRole('button', { name: '健康档案', exact: true }).click();
  await page.getByRole('tablist', { name: '健康档案分类' }).waitFor();
  for (const [kind, label] of [['checkup', '体检'], ['visit', '就医']]) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true');
    const panel = page.getByRole('tabpanel', { name: label, exact: true });
    assert.equal(await panel.locator('.health-record').count(), 1);
    assert.equal(await panel.getByRole('button', { name: `编辑${label} · 健康测试医院`, exact: true }).count(), 1);
    await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
    await page.getByRole('dialog', { name: `记录${label}`, exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `artifacts/health-medical-${kind}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByRole('tab', { name: '就医', exact: true }).press('ArrowLeft');
  assert.equal(await page.getByRole('tab', { name: '体检', exact: true }).getAttribute('aria-selected'), 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await page.getByRole('button', { name: '饮食运动详情', exact: true }).click();
  await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
  await page.getByRole('dialog', { name: '添加健康记录', exact: true }).waitFor();
  assert.equal(await page.locator('.health-add-menu button').count(), 2);
  await page.locator('.health-add-menu').getByRole('button', { name: '运动', exact: true }).click();
  await page.getByRole('dialog', { name: '记录运动', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await dashboard.getByRole('button', { name: '体重趋势', exact: true }).first().click();
  await dashboard.getByText('23.9', { exact: true }).waitFor();
  await api('/account/profile', { gender: 'male' }, 'PATCH');
  await go();
  assert.equal(await dashboard.getByRole('button', { name: '打开生理周期', exact: true }).count(), 0);
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.some(e => e.kind === 'period'), false);
  await api('/account/profile', { gender: 'female' }, 'PATCH');
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.filter(e => e.kind === 'period').length, 1);
  await go();
  await dashboard.getByRole('button', { name: '查看健康记录', exact: true }).click();
  await page.getByRole('button', { name: '编辑饮食', exact: true }).first().click();
  await page.getByLabel('该份热量（千卡）', { exact: true }).first().fill('250');
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '删除饮食', exact: true }).first().click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await dashboard.getByRole('button', { name: '返回健康首页', exact: true }).click();
  await page.getByRole('button', { name: '添加早餐', exact: true }).click();
  await page.getByRole('button', { name: '手动填写', exact: true }).click();
  await page.getByRole('button', { name: '添加食物', exact: true }).click();
  await page.getByLabel('食物名称', { exact: true }).fill('第二项');
  await page.getByLabel('该份热量（千卡）', { exact: true }).fill('100');
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByText('请完善食物 1 的名称和营养数值', { exact: true }).waitFor();
  await page.getByLabel('食物名称', { exact: true }).fill('第一项');
  await page.getByLabel('该份热量（千卡）', { exact: true }).fill('80');
  await page.getByRole('button', { name: '下一项食物', exact: true }).click();
  assert.equal(await page.getByLabel('食物名称', { exact: true }).inputValue(), '第二项');
  await page.setViewportSize({ width: 320, height: 430 });
  await page.locator('.health-editor').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const saveBounds = await page.getByRole('button', { name: '确认保存', exact: true }).boundingBox();
  assert.ok(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 430, 'Save remains reachable in keyboard-sized viewport');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await go();
  await page.locator('.health-tile.medical').click();
  for (const [kind, label] of [['checkup', '体检'], ['visit', '就医'], ['vision', '视力']]) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    const before = (await api('/health/dashboard', null, 'GET')).entries.length;
    await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
    const photoEntry = page.getByRole('button', { name: '拍照识别报告', exact: true });
    const entryBounds = await photoEntry.boundingBox();
    const rowBounds = await page.locator('.health-medical-entry-mode').boundingBox();
    assert.ok(Math.abs(entryBounds.x + entryBounds.width - rowBounds.x - rowBounds.width) < 2, `${kind} photo entry aligns right`);
    await photoEntry.click();
    assert.deepEqual(await page.locator('.health-photo-buttons button').allTextContents(), ['相册', '拍照']);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '拍照识别报告', exact: true }).click();
    await page.getByLabel('选择识别报告', { exact: true }).setInputFiles({ name: 'report.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await page.getByAltText('待识别报告', { exact: true }).waitFor();
    const recognizeReport = page.getByRole('button', { name: '识别并填入表单', exact: true });
    assert.equal(await recognizeReport.isDisabled(), true);
    await page.getByLabel(/同意将此报告照片/).check();
    if (kind === 'checkup') {
      validReport = false;
      await recognizeReport.click();
      await page.getByText('未识别到相关报告，请选择清晰的报告照片', { exact: true }).waitFor();
      validReport = true;
    }
    await recognizeReport.click();
    await page.getByText('识别可能有误，请逐项核对日期、左右眼和数值后保存。', { exact: true }).waitFor();
    assert.equal((await api('/health/dashboard', null, 'GET')).entries.length, before);
    assert.equal(await page.getByLabel(kind === 'vision' ? '检查机构（可不填）' : kind === 'checkup' ? '体检机构' : '医院', { exact: true }).inputValue(), '报告识别医院');
    const count = kind === 'vision' ? 5 : 3;
    for (let step = 0; step < count - 1; step++) {
      if (kind === 'vision' && step === 1) {
        assert.equal(await page.getByLabel('左眼裸眼视力', { exact: true }).inputValue(), '0.8');
        await page.getByLabel('左眼裸眼视力', { exact: true }).fill('0.9');
      }
      if (kind === 'vision' && step === 2) {
        assert.equal(await page.getByLabel('左眼球镜（D）', { exact: true }).inputValue(), '-2.25');
        assert.equal(await page.getByLabel('右眼球镜（D）', { exact: true }).inputValue(), '+1.00');
      }
      if (kind === 'vision') {
        await page.setViewportSize({ width: 320, height: 740 });
        assert.equal(await page.locator('.health-editor').evaluate(el => el.scrollHeight > el.clientHeight + 2), false);
        await page.screenshot({ path: `artifacts/health-vision-step-${step}.png` });
      }
      await page.getByRole('button', { name: '下一步', exact: true }).click();
    }
    await page.getByAltText('留档照片1', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const records = (await api('/health/dashboard', null, 'GET')).entries;
    assert.equal(records.length, before + 1);
    const saved = records.find(record => record.kind === kind && record.institution === '报告识别医院');
    assert.equal(saved.photos.length, 1);
    assert.equal(saved.name, undefined);
    if (kind === 'vision') assert.equal(saved.leftUnaided, '0.9');
    if (kind === 'visit') assert.equal(saved.followUp, '');
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const beforeCancel = (await api('/health/dashboard', null, 'GET')).entries.length;
  await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
  await page.getByRole('button', { name: '拍照识别报告', exact: true }).click();
  await page.getByLabel('选择识别报告', { exact: true }).setInputFiles({ name: 'report.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByAltText('待识别报告', { exact: true }).waitFor();
  await page.getByLabel(/同意将此报告照片/).check();
  await page.getByRole('button', { name: '识别并填入表单', exact: true }).click();
  await page.getByText('识别可能有误，请逐项核对日期、左右眼和数值后保存。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/health/dashboard', null, 'GET')).entries.length, beforeCancel);
  assert.equal(reportCalls, 5);
  await page.getByRole('button', { name: '编辑视力 · 报告识别医院', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await page.getByLabel('左眼裸眼视力', { exact: true }).inputValue(), '0.9');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '删除视力 · 报告识别医院', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await go();
  await page.getByRole('button', { name: '打开喝水记录', exact: true }).click();
  await page.getByLabel('健康记录日期', { exact: true }).fill('2020-01-10');
  await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByLabel('日期', { exact: true }).inputValue(), today);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '前一天', exact: true }).click();
  assert.equal(await page.getByLabel('健康记录日期', { exact: true }).inputValue(), '2020-01-09');
  await page.getByRole('button', { name: '返回健康首页', exact: true }).click();
  assert.equal(await dashboard.getByLabel('健康记录日期', { exact: true }).count(), 0);
  assert.ok((await page.getByRole('button', { name: '打开喝水记录', exact: true }).innerText()).includes(today));
  await page.getByRole('button', { name: '饮食运动详情', exact: true }).click();
  assert.equal(await page.getByLabel('健康记录日期', { exact: true }).inputValue(), today, 'Views do not inherit another view date');
  await page.getByLabel('健康记录日期', { exact: true }).fill('2020-01-10');
  await page.getByRole('button', { name: '添加早餐', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getByLabel('日期', { exact: true }).inputValue(), today);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '返回健康首页', exact: true }).click();
  for (const kind of ['weight', 'bowel', 'sleep', 'period', 'medical']) {
    await page.locator(`.health-tile.${kind}`).click();
    if (kind === 'medical') await page.getByRole('tab', { name: '体检', exact: true }).click();
    const unfiltered = await dashboard.locator('.health-record').count();
    assert.ok(unfiltered > 0, `${kind} has history`);
    await page.getByLabel('健康记录日期', { exact: true }).fill('2020-01-10');
    assert.equal(await dashboard.locator('.health-record').count(), 0, `${kind} filters by query date`);
    await page.getByRole('button', { name: '添加健康记录', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByLabel(kind === 'period' ? '开始日期' : kind === 'weight' ? '记录日期' : '日期', { exact: true }).inputValue(), today);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    if (kind === 'medical') {
      await page.getByRole('tab', { name: '就医', exact: true }).click();
      assert.equal(await page.getByLabel('健康记录日期', { exact: true }).inputValue(), '', 'Medical tab filters are independent');
      await page.getByRole('tab', { name: '体检', exact: true }).click();
      assert.equal(await page.getByLabel('健康记录日期', { exact: true }).inputValue(), '2020-01-10');
    }
    await page.setViewportSize({ width: 320, height: 740 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `artifacts/health-date-query-${kind}.png`, fullPage: true });
    await page.getByRole('button', { name: '清除日期筛选', exact: true }).click();
    assert.equal(await dashboard.locator('.health-record').count(), unfiltered);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '返回健康首页', exact: true }).click();
  }
  await page.screenshot({ path: 'artifacts/health-home-no-date.png', fullPage: true });
  const minor = await api('/register', { username: 'health-minor', password: 'HealthUiTest123!', name: '未成年测试', birthday: '2015-01-01', invite: 'health-ui' });
  const minorPage = await browser.newPage({ viewport: { width: 320, height: 700 } });
  await minorPage.addInitScript(({ base, token }) => {
    localStorage.setItem('zaizai-server', base); localStorage.setItem('zaizai-token', token);
  }, { base, token: minor.token });
  await minorPage.goto('http://127.0.0.1:5173');
  await minorPage.locator('.mobile-nav').getByRole('button', { name: '健康', exact: true }).click();
  await minorPage.getByRole('button', { name: '健康目标设置', exact: true }).click();
  assert.equal(await minorPage.getByLabel('自设目标体重（kg，可不填）', { exact: true }).count(), 0);
  assert.equal(await minorPage.getByLabel('自设每日饮食热量（千卡，可不填）', { exact: true }).count(), 0);
  await minorPage.getByRole('button', { name: '取消', exact: true }).click();
  await minorPage.getByRole('button', { name: '打开生理周期', exact: true }).click();
  await minorPage.getByLabel('性别', { exact: true }).selectOption('male');
  await minorPage.getByRole('button', { name: '保存', exact: true }).click();
  await minorPage.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await minorPage.locator('.health-dashboard').getByRole('button', { name: '打开生理周期', exact: true }).count(), 0);
  await minorPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: isolated health API, food and medical photo consent/error/review/save/cancel, three medical tabs, vision notation/edit/delete, preference persistence and responsive layouts. AI provider mocked, not a real recognition-quality test.');
} catch (error) {
  await page?.screenshot({ path: 'artifacts/health-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  const exit = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exit;
  await close(ai);
  rmSync(dir, { recursive: true, force: true });
}
