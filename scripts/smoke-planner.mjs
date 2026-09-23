import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { plannerToday, shiftDate, weekday } from '../shared/planner.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'zaizai-planner-test-'));
let modelDelay = 0, invalidModel = false, modelRequests = 0;
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw), title = JSON.parse(body.messages.at(-1).content).title;
  if (typeof title !== 'string') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '测试响应' } }] }));
    return;
  }
  assert.equal(body.tools, undefined);
  modelRequests++;
  const content = JSON.stringify({ category: invalidModel ? 'invalid' : title.includes('采购') ? '采购' : title.includes('英语') ? '学习' : '工作' });
  const reply = () => res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  res.setHeader('Content-Type', 'application/json');
  if (modelDelay) setTimeout(reply, modelDelay); else reply();
});
await new Promise(done => provider.listen(0, '127.0.0.1', done));
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`, today = plannerToday();
let child, browser, token;
async function api(path, body, method = body ? 'POST' : 'GET', expected = 200, auth = token) {
  const response = await fetch(`${base}/api${path}`, { method, headers: {
    'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, data.error || path);
  return data;
}
try {
  child = spawn(process.execPath, ['server/index.mjs'], { windowsHide: true, env: { ...process.env,
    HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, INVITE_CODE: 'planner-test',
    CPA_BASE_URL: `http://127.0.0.1:${provider.address().port}`, CPA_API_KEY: 'fixture-only',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend startup timeout')), 10000);
    child.stdout.on('data', data => { if (data.toString().includes('Zaizai server:')) { clearTimeout(timeout); done(); } });
    child.once('error', reject);
  });
  token = (await api('/register', { username: 'planner-test', name: '测试', birthday: '2000-01-01', password: 'planner-password-123', invite: 'planner-test' })).token;
  await api('/planner', null, 'GET', 401, '');
  await api('/tasks/classify', { title: '' }, 'POST', 400);
  for (const [title, category, scheduledDate, priority] of [
    ['整理项目会议材料', '工作', today, 'high'], ['阅读一本书的第一章', '学习', today, 'normal'],
    ['采购本周食材', '生活', shiftDate(today, 1), 'normal'], ['整理旅行清单', '生活', '', 'low'],
    ['回顾英语单词', '学习', shiftDate(today, -1), 'normal'],
  ]) await api('/records', { kind: 'task', confirmed: true, payload: { title, category, scheduledDate, priority, note: '' } }, 'POST', 201);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('zaizai-token', value), token);
  await page.goto(base);
  const nav = page.locator('.mobile-nav');
  await nav.getByRole('button', { name: '待办', exact: true }).click();
  const views = page.getByRole('tablist', { name: '日程视图' });
  assert.equal(await views.getByRole('tab').count(), 3);
  assert.equal(await views.getByRole('tab', { name: '清单', exact: true }).count(), 0);
  assert.equal(await views.getByRole('tab', { name: '待办', exact: true }).getAttribute('aria-selected'), 'true');
  await page.locator('.planner-month-board').waitFor();
  async function showList() {
    await views.getByRole('tab', { name: '待办', exact: true }).click();
    await page.getByRole('button', { name: '清单', exact: true }).click();
  }
  async function createFromMenu(label) {
    await nav.getByRole('button', { name: '添加待办', exact: true }).click();
    await page.locator('.add-menu').getByRole('button', { name: label, exact: true }).click();
  }
  async function chooseMonth(month) {
    await page.getByRole('button', { name: '日历月份', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '选择月份', exact: true });
    await scrollMonthWheel(picker, '年份', `${Number(month.slice(0, 4))}年`);
    await scrollMonthWheel(picker, '月份', `${Number(month.slice(5))}月`);
    await picker.getByRole('button', { name: '确定', exact: true }).click();
  }
  async function scrollMonthWheel(picker, label, value) {
    const wheel = picker.getByRole('listbox', { name: label === '年份' ? '年' : '月', exact: true });
    const option = wheel.getByRole('option', { name: value, exact: true });
    await option.evaluate(el => el.parentElement.scrollTo({ top: Array.from(el.parentElement.children).indexOf(el) * 40 }));
    await wheel.locator('[aria-selected="true"]').filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
  }
  async function chooseCategory(category) {
    await page.getByRole('button', { name: '待办分类', exact: true }).click();
    await page.getByRole('dialog', { name: '选择待办分类', exact: true }).getByRole('button', { name: category, exact: true }).click();
  }
  await showList();
  await page.getByRole('button', { name: '编辑整理项目会议材料', exact: true }).waitFor();
  assert.equal(await page.locator('.planner-task').count(), 5);
  await page.getByLabel('日程范围').selectOption('today');
  assert.equal(await page.locator('.planner-task').count(), 2);
  await page.locator('.planner-category-trigger').click();
  await page.getByRole('dialog', { name: '清单分类' }).getByRole('button', { name: /学习/ }).click();
  assert.equal(await page.locator('.planner-task').count(), 1);
  assert.equal(await page.locator('.planner-task-meta .task-category-icon').count(), 0);
  await page.getByRole('button', { name: '返回日历', exact: true }).click();
  assert.equal(await page.locator('.planner-category-trigger').count(), 0);
  await page.getByRole('button', { name: `查看${today}详情`, exact: true }).click();
  assert.equal(await page.locator('.planner-task').count(), 2);
  await page.keyboard.press('Escape');
  await showList();
  assert.equal(await page.locator('.planner-category-trigger').count(), 1);
  await page.getByRole('button', { name: '完成阅读一本书的第一章', exact: true }).click();
  await page.getByRole('group', { name: '待办状态' }).getByRole('button', { name: /已完成/ }).click();
  await page.getByRole('button', { name: '恢复阅读一本书的第一章', exact: true }).click();
  await page.getByRole('group', { name: '待办状态' }).getByRole('button', { name: /未完成/ }).click();
  await page.locator('.planner-category-trigger').click();
  await page.getByRole('dialog', { name: '清单分类' }).getByRole('button', { name: /全部分类/ }).click();
  await page.getByLabel('日程范围').selectOption('all');
  await createFromMenu('添加待办');
  assert.equal(await page.getByRole('button', { name: '重新自动分类', exact: true }).count(), 0);
  await page.getByLabel('要做的事', { exact: true }).fill('英语学习计划');
  await page.waitForFunction(() => document.querySelector('input[name="category"]')?.value === '学习');
  await page.getByLabel('要做的事', { exact: true }).fill('采购办公用品');
  await page.waitForFunction(() => document.querySelector('input[name="category"]')?.value === '采购');
  await page.getByLabel('要做的事', { exact: true }).fill('英语学习计划');
  await page.waitForFunction(() => document.querySelector('input[name="category"]')?.value === '学习');
  assert.equal(await page.locator('.task-classification-state').count(), 0);
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '待办分类', exact: true }).click();
    const choices = page.getByRole('dialog', { name: '选择待办分类', exact: true });
    assert.equal(await choices.locator('.task-category-choices>button').count(), 24);
    assert.equal(await choices.locator('.task-category-icon svg').count(), 24);
    assert.equal(await choices.getByRole('button', { name: '学习', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await choices.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/task-category-icons-${width}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '添加待办', exact: true }).waitFor();
    assert.equal(await page.locator('input[name="category"]').inputValue(), '学习');
    assert.equal(await page.getByLabel('要做的事', { exact: true }).inputValue(), '英语学习计划');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const category of ['工作', '会议', '项目', '后勤', '采购', '报销', '学习', '作业', '考试', '阅读', '家务', '购物', '出行', '健康', '运动', '就医', '用药', '财务', '缴费', '还款', '收款', '社交', '其他', '生活']) {
    await chooseCategory(category);
    assert.equal(await page.locator('input[name="category"]').inputValue(), category);
    assert.equal(await page.getByRole('button', { name: '待办分类', exact: true }).innerText(), category);
  }
  const previous = modelRequests;
  await page.getByLabel('要做的事', { exact: true }).fill('手动选择的计划');
  await page.waitForTimeout(1100);
  assert.equal(modelRequests, previous);
  await page.getByLabel('安排日期', { exact: true }).fill(today);
  await page.getByLabel('事项发生日期', { exact: true }).fill('2026-09-01');
  await page.getByLabel('事项发生日期', { exact: true }).click();
  const dateSheet = page.getByRole('dialog', { name: '选择日期', exact: true });
  await scrollMonthWheel(dateSheet, '年份', '2024年');
  await scrollMonthWheel(dateSheet, '月份', '2月');
  await dateSheet.getByRole('listbox', { name: '日', exact: true }).press('End');
  assert.equal(await dateSheet.getByRole('listbox', { name: '日', exact: true }).getByRole('option', { selected: true }).textContent(), '29日');
  assert.equal(await dateSheet.getByRole('option', { name: '整月', exact: true }).count(), 0);
  await dateSheet.getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await page.getByLabel('事项发生日期', { exact: true }).inputValue(), '2024-02-29');
  await page.getByLabel('事项发生日期', { exact: true }).click();
  await scrollMonthWheel(dateSheet, '年份', '2025年');
  assert.equal(await dateSheet.getByRole('listbox', { name: '日', exact: true }).getByRole('option', { selected: true }).textContent(), '28日');
  await dateSheet.getByRole('button', { name: '返回', exact: true }).click();
  assert.equal(await page.getByLabel('事项发生日期', { exact: true }).inputValue(), '2024-02-29');
  await page.getByLabel('事项发生日期', { exact: true }).click();
  await dateSheet.getByRole('button', { name: '清空', exact: true }).click();
  assert.equal(await page.getByLabel('事项发生日期', { exact: true }).inputValue(), '');
  await page.getByLabel('事项发生日期', { exact: true }).fill('2026-09-01');
  await page.getByLabel('提醒时间', { exact: true }).fill('2026-09-23T09:00');
  await page.getByLabel('提醒时间', { exact: true }).click();
  const timeSheet = page.getByRole('dialog', { name: '选择提醒时间', exact: true });
  assert.equal(await timeSheet.getByRole('listbox').count(), 5);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    assert.equal(await timeSheet.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await timeSheet.evaluate(el => Math.abs(el.getBoundingClientRect().bottom - innerHeight) < 2), true);
    await page.screenshot({ path: `artifacts/unified-datetime-${width}.png` });
  }
  await timeSheet.getByRole('listbox', { name: '分', exact: true }).press('ArrowDown');
  await timeSheet.getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await page.getByLabel('提醒时间', { exact: true }).inputValue(), '2026-09-23T09:01');
  await page.getByLabel('提醒时间', { exact: true }).fill('2026-09-23T09:00');
  await page.getByRole('button', { name: '每周', exact: true }).click();
  await page.getByRole('button', { name: '周二', exact: true }).click();
  await page.getByRole('button', { name: '周五', exact: true }).click();
  await page.getByLabel('提醒时间', { exact: true }).click();
  const repeatClock = page.getByRole('dialog', { name: '选择时间', exact: true });
  assert.equal(await repeatClock.getByRole('listbox').count(), 2);
  await repeatClock.getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await page.locator('.task-repeat-summary').innerText(), '每周二、周五 09:00');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const taskForm = page.locator('.planner-task-editor .record-form');
    assert.equal(await taskForm.evaluate(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)), true,
      'Task form must support user scrolling');
    const headerTop = await page.locator('.planner-task-editor .modal-heading').evaluate(el => el.getBoundingClientRect().top);
    await taskForm.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await taskForm.getByRole('button', { name: '保存', exact: true }).evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }), true, 'Save button can be reached by scrolling');
    assert.equal(await page.locator('.planner-task-editor .modal-heading').evaluate(el => el.getBoundingClientRect().top), headerTop);
    await page.locator('.task-schedule').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.task-schedule').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/task-trace-reminder-${width}.png` });
  }
  await page.getByLabel('备注', { exact: true }).fill('分类保持手动选择');
  const taskNote = page.getByLabel('备注', { exact: true });
  const noteHeight = await taskNote.evaluate(el => el.clientHeight);
  const longNote = '采购记录：核对数量、费用及收货情况。\n'.repeat(16);
  await taskNote.fill(longNote);
  assert.equal(await taskNote.evaluate(el => el.scrollHeight <= el.clientHeight), true);
  assert.ok(await taskNote.evaluate(el => el.clientHeight) > noteHeight);
  await taskNote.fill('');
  assert.equal(await taskNote.evaluate(el => el.clientHeight), noteHeight);
  await taskNote.fill(longNote);
  const photoFixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#126ac4'; ctx.fillRect(20, 20, 280, 40);
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#333'; ctx.fillText('Purchase record - test', 20, 100);
    const first = canvas.toDataURL('image/png').split(',')[1];
    ctx.fillText('Second attachment', 20, 150);
    return [first, canvas.toDataURL('image/png').split(',')[1]];
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator('.planner-task-editor .record-form').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByLabel('拍摄留档照片', { exact: true }).setInputFiles({
    name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photoFixture[0], 'base64'),
  });
  await page.locator('.task-photo-item img').waitFor();
  assert.equal(await page.locator('.task-photo-item img').evaluate(img => {
    const bounds = img.getBoundingClientRect();
    return img.complete && img.naturalWidth > 0 && bounds.top >= 64 && bounds.bottom <= window.innerHeight;
  }), true, 'Camera thumbnail is visible immediately without saving or manual scrolling');
  await page.getByLabel('选择留档照片', { exact: true }).setInputFiles({
    name: 'album.png', mimeType: 'image/png', buffer: Buffer.from(photoFixture[1], 'base64'),
  });
  await page.getByRole('button', { name: '查看留档照片1', exact: true }).click();
  await page.getByRole('dialog', { name: '留档照片预览', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '留档照片预览', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog', { name: '添加待办', exact: true }).count(), 1);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.task-photos').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.task-photo-item').count(), 2);
    assert.equal(await page.locator('.task-photos').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/task-photos-${width}.png` });
  }
  assert.equal(await page.getByRole('group', { name: '优先级', exact: true }).getByRole('radio').count(), 4);
  await page.getByRole('radio', { name: '紧急不重要', exact: true }).check();
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.task-priority-field').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.task-priority-options').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('.task-priority-field').screenshot({ path: `artifacts/task-priority-options-${width}.png` });
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '添加待办' }).waitFor({ state: 'hidden' });
  assert.equal((await api('/state')).records.find(record => record.payload.title === '手动选择的计划').payload.category, '生活');
  assert.equal((await api('/state')).records.find(record => record.payload.title === '手动选择的计划').payload.priority, 'urgent');
  await page.getByRole('button', { name: '编辑手动选择的计划', exact: true }).click();
  const traceRecord = (await api('/state')).records.find(record => record.payload.title === '手动选择的计划');
  assert.equal(traceRecord.payload.occurredDate, '2026-09-01');
  assert.equal(traceRecord.payload.reminderRepeat, 'weekly');
  assert.deepEqual(traceRecord.payload.reminderDays, [2, 5]);
  assert.equal(await page.getByRole('button', { name: '周二', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '周五', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(traceRecord.payload.due, '2026-09-23T01:00:00.000Z');
  assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), longNote.trim());
  assert.equal(await page.getByLabel('备注', { exact: true }).evaluate(el => el.scrollHeight <= el.clientHeight), true,
    'Saved long notes expand on opening without input');
  assert.equal(traceRecord.payload.photos.length, 2);
  assert.ok(!JSON.stringify(traceRecord).includes('data:image'));
  assert.match((await api(`/task-photos/${traceRecord.payload.photos[0]}`)).image, /^data:image\/jpeg;base64,/);
  await page.getByRole('button', { name: '查看留档照片1', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: '留档照片预览', exact: true }).locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.getByRole('button', { name: '关闭照片预览', exact: true }).click();
  await page.getByRole('button', { name: '移除留档照片2', exact: true }).click();
  await page.getByRole('button', { name: '移除留档照片1', exact: true }).click();
  assert.notEqual(await page.locator('.task-schedule output').innerText(), '待保存');
  await page.getByRole('button', { name: '每月', exact: true }).click();
  await chooseCategory('采购');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('请至少选择一个提醒日期', { exact: true }).waitFor();
  for (const day of [1, 5, 20]) await page.getByRole('button', { name: `每月${day}日`, exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.task-repeat-days').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.task-repeat-day-grid').evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.locator('.task-repeat-day-grid').evaluate(el => [...el.children].every(button => {
      const bounds = button.getBoundingClientRect(), style = getComputedStyle(button);
      return Math.abs(bounds.width - bounds.height) < 1 && style.borderRadius === '50%' &&
        (button.getAttribute('aria-pressed') === 'true'
          ? style.color === 'rgb(255, 255, 255)' &&
            style.backgroundColor !== 'rgb(241, 244, 248)'
          : style.backgroundColor === 'rgb(241, 244, 248)');
    })), true, 'Repeat dates use round buttons with pale idle and white selected text');
    await page.screenshot({ path: `artifacts/task-monthly-days-${width}.png` });
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '修改记录', exact: true }).waitFor({ state: 'hidden' });
  const traceEdited = (await api('/state')).records.find(record => record.id === traceRecord.id);
  assert.equal(traceEdited.created, traceRecord.created);
  assert.equal(traceEdited.payload.reminderRepeat, 'monthly');
  assert.equal(traceEdited.payload.category, '采购');
  assert.deepEqual(traceEdited.payload.reminderDays, [1, 5, 20]);
  assert.deepEqual(traceEdited.payload.photos, []);
  await page.getByRole('button', { name: '编辑手动选择的计划', exact: true }).click();
  for (const day of [1, 5, 20]) assert.equal(await page.getByRole('button', { name: `每月${day}日`, exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('radio', { name: '紧急不重要', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await createFromMenu('添加待办');
  modelDelay = 2000;
  await page.getByLabel('要做的事', { exact: true }).fill('迟到分类回复');
  await page.waitForTimeout(1050);
  await chooseCategory('财务');
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('input[name="category"]').inputValue(), '财务');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  modelDelay = 0; invalidModel = true;
  await createFromMenu('添加待办');
  await page.getByLabel('要做的事', { exact: true }).fill('异常分类回复');
  await page.waitForResponse(response => response.url().endsWith('/api/tasks/classify'));
  await page.waitForFunction(() => {
    const save = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '保存');
    return save && !save.disabled;
  });
  assert.equal(await page.locator('input[name="category"]').inputValue(), '其他');
  assert.equal(await page.locator('.task-classification-state').count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  invalidModel = false;
  await views.getByRole('tab', { name: '待办', exact: true }).click();
  await page.locator('.planner-month-grid').getByRole('button', { name: new RegExp(`^${today}，`) }).click();
  assert.equal(await page.locator('.planner-task').count(), 0);
  assert([28, 35, 42].includes(await page.locator('.planner-month-cell').count()));
  assert.equal(await page.locator(`[data-date="${today}"] .planner-calendar-event`).count(), Math.min(3, Number(await page.locator('.planner-month-grid').getAttribute('data-capacity'))));
  await page.getByRole('button', { name: `查看${today}详情`, exact: true }).click();
  assert.equal(await page.locator('.planner-task').count(), 3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '下个月', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '今天', exact: true }).innerText(), `${Number(today.slice(8))}日`);
  assert.equal(await page.locator('.planner-today-number').evaluate(el => getComputedStyle(el).fontSize), '18px');
  assert.equal(await page.getByRole('button', { name: '今天', exact: true }).evaluate(el => getComputedStyle(el).fontSize), '11px');
  assert.equal(await page.getByLabel('日历月份').getAttribute('data-month'), today.slice(0, 7));
  await page.getByLabel('日历月份').click();
  const monthPicker = page.getByRole('dialog', { name: '选择月份', exact: true });
  await scrollMonthWheel(monthPicker, '年份', '2030年');
  await scrollMonthWheel(monthPicker, '月份', '2月');
  assert.equal(await monthPicker.getByRole('button', { name: '清除', exact: true }).count(), 0);
  await monthPicker.getByRole('button', { name: '返回', exact: true }).click();
  assert.equal(await page.getByLabel('日历月份').getAttribute('data-month'), today.slice(0, 7));
  assert.equal(await page.locator(`[data-date="${today}"] .planner-cell-date`).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('日历月份').click();
  assert.equal(await monthPicker.getByRole('listbox', { name: '年', exact: true }).getByRole('option', { selected: true }).textContent(), `${today.slice(0, 4)}年`);
  const yearWheel = monthPicker.getByRole('listbox', { name: '年', exact: true });
  await yearWheel.focus();
  await page.keyboard.press('Home');
  assert.equal(await yearWheel.getByRole('option', { selected: true }).textContent(), '1901年');
  await page.keyboard.press('ArrowUp');
  assert.equal(await yearWheel.getByRole('option', { selected: true }).textContent(), '1901年');
  await page.keyboard.press('End');
  assert.equal(await yearWheel.getByRole('option', { selected: true }).textContent(), '2100年');
  await page.keyboard.press('ArrowDown');
  assert.equal(await yearWheel.getByRole('option', { selected: true }).textContent(), '2100年');
  await yearWheel.getByRole('option', { name: '2099年', exact: true }).click();
  assert.equal(await yearWheel.getByRole('option', { selected: true }).textContent(), '2099年');
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: '添加待办', exact: true }).click();
  await page.getByRole('dialog', { name: '添加日程' }).getByRole('button', { name: '添加待办', exact: true }).click();
  assert.equal(await page.getByLabel('安排日期', { exact: true }).inputValue(), today);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await nav.getByRole('button', { name: '添加待办', exact: true }).click();
  await page.getByRole('button', { name: '添加纪念日', exact: true }).click();
  await page.getByLabel('纪念日名称', { exact: true }).fill('结婚纪念日');
  await page.getByLabel('原始日期（公历）', { exact: true }).fill(today);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '添加纪念日', exact: true }).waitFor({ state: 'hidden' });
  const anniversary = (await api('/planner')).items.find(item => item.kind === 'anniversary');
  assert.equal(anniversary.payload.repeat, 'yearly');
  await page.getByRole('button', { name: `查看${today}详情`, exact: true }).click();
  await page.getByRole('dialog', { name: today, exact: true }).getByRole('button', { name: '结婚纪念日', exact: true }).click();
  await page.getByLabel('纪念日名称', { exact: true }).fill('我们的纪念日');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑纪念日', exact: true }).waitFor({ state: 'hidden' });
  await views.getByRole('tab', { name: '打卡', exact: true }).click();
  await createFromMenu('新建目标');
  await page.getByLabel('习惯名称', { exact: true }).fill('每天阅读');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '打卡每天阅读', exact: true }).click();
  await page.getByRole('button', { name: '取消打卡每天阅读', exact: true }).waitFor();
  const readingAppearance = (await api('/planner')).items.find(item => item.payload.title === '每天阅读').payload;
  assert.equal(readingAppearance.icon, 'book');
  assert.equal(readingAppearance.tone, 'blue');
  assert.equal((await api('/planner')).checks.length, 1);
  await page.locator('.planner-habit-body').filter({ hasText: '每天阅读' }).click();
  await page.getByText('累计打卡 1 天', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('习惯名称').fill('每日阅读');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '取消打卡每日阅读', exact: true }).waitFor();
  await createFromMenu('新建目标');
  await page.getByRole('dialog', { name: '新建目标', exact: true }).waitFor();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  const suggestions = page.getByRole('dialog', { name: '推荐目标', exact: true });
  await suggestions.getByRole('tab', { name: '健康', exact: true }).click();
  assert.equal(await suggestions.locator('.habit-template-grid>button').count(), 10);
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await suggestions.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/habit-recommendations-${width}.png` });
  }
  await suggestions.getByRole('button', { name: '早睡', exact: true }).click();
  assert.equal(await page.getByLabel('习惯名称', { exact: true }).inputValue(), '早睡');
  assert.equal(await page.getByLabel('提醒时间1', { exact: true }).inputValue(), '22:00');
  await page.getByLabel('提醒时间1', { exact: true }).click();
  const clockSheet = page.getByRole('dialog', { name: '选择时间', exact: true });
  assert.equal(await clockSheet.getByRole('listbox').count(), 2);
  await clockSheet.getByRole('listbox', { name: '分', exact: true }).press('ArrowDown');
  await clockSheet.getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await page.getByLabel('提醒时间1', { exact: true }).inputValue(), '22:01');
  assert.equal(await page.getByRole('button', { name: '选择目标图标', exact: true }).count(), 0);
  assert.equal(await page.getByRole('group', { name: '目标颜色', exact: true }).count(), 0);
  await page.getByRole('button', { name: '周弹性', exact: true }).click();
  await page.getByLabel('每周次数', { exact: true }).fill('2');
  await page.getByRole('button', { name: '月定期', exact: true }).click();
  await page.getByRole('button', { name: '每月31日', exact: true }).click();
  await page.getByRole('button', { name: '月弹性', exact: true }).click();
  await page.getByLabel('每月次数', { exact: true }).fill('5');
  await page.getByRole('button', { name: '周定期', exact: true }).click();
  await page.getByRole('switch', { name: '提醒', exact: true }).uncheck();
  await page.getByRole('switch', { name: '专注模式', exact: true }).check();
  await page.getByLabel('专注时长（分钟）', { exact: true }).fill('1');
  await page.getByRole('switch', { name: '跳过法定节假日', exact: true }).check();
  await page.getByRole('switch', { name: '无限期目标', exact: true }).uncheck();
  await page.getByLabel('结束日期', { exact: true }).click();
  const endDateSheet = page.getByRole('dialog', { name: '选择日期', exact: true });
  for (const label of ['年', '月', '日']) await endDateSheet.getByRole('listbox', { name: label, exact: true }).press('Home');
  assert.equal(await endDateSheet.getByRole('listbox', { name: '年', exact: true }).getByRole('option', { selected: true }).textContent(), `${Number(today.slice(0, 4))}年`);
  assert.equal(await endDateSheet.getByRole('listbox', { name: '月', exact: true }).getByRole('option', { selected: true }).textContent(), `${Number(today.slice(5, 7))}月`);
  assert.equal(await endDateSheet.getByRole('listbox', { name: '日', exact: true }).getByRole('option', { selected: true }).textContent(), `${Number(today.slice(8))}日`);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: '新建目标', exact: true }).count(), 1);
  await page.getByLabel('结束日期', { exact: true }).fill(shiftDate(today, 10));
  await page.getByLabel('习惯名称', { exact: true }).fill('专注测试');
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const editor = page.getByRole('dialog', { name: '新建目标', exact: true });
    await editor.locator('.habit-form').evaluate(el => { el.scrollTop = 0; });
    assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/habit-editor-${width}.png` });
    await page.getByRole('switch', { name: '专注模式', exact: true }).scrollIntoViewIfNeeded();
    const headingTop = await editor.locator('.modal-heading').evaluate(el => el.getBoundingClientRect().top);
    await page.getByLabel('结束日期', { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await editor.locator('.modal-heading').evaluate(el => el.getBoundingClientRect().top), headingTop);
    assert.equal(await editor.locator('.habit-date-fields input').evaluateAll(inputs => inputs.every(input => {
      const style = getComputedStyle(input, '::-webkit-calendar-picker-indicator');
      return parseFloat(style.width) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) >= 44 &&
        parseFloat(style.height) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) >= 44 &&
        input.getBoundingClientRect().height >= 48;
    })), true, `Date picker icons have 44px touch targets at ${width}px`);
    assert.equal(await page.locator('.habit-switch-row').evaluateAll(rows => rows.every(row => {
      const input = row.querySelector('input').getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return Math.abs(input.top + input.height / 2 - bounds.top - bounds.height / 2) < 1 && input.right <= bounds.right + 1;
    })), true);
    await page.screenshot({ path: `artifacts/habit-editor-settings-${width}.png` });
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '新建目标', exact: true }).waitFor({ state: 'hidden' });
  const focusItem = (await api('/planner')).items.find(item => item.payload.title === '专注测试');
  assert.equal(focusItem.payload.focusMinutes, 1);
  assert.equal(focusItem.payload.icon, 'target');
  assert.equal(focusItem.payload.tone, 'blue');
  assert.equal(focusItem.payload.endDate, shiftDate(today, 10));
  await page.getByRole('button', { name: '开始专注专注测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const frozen = await page.getByLabel('专注倒计时', { exact: true }).textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.getByLabel('专注倒计时', { exact: true }).textContent(), frozen);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '结束', exact: true }).click();
  assert.equal((await api('/planner')).checks.some(check => check.item_id === focusItem.id), false);
  await page.getByRole('button', { name: '开始专注专注测试', exact: true }).click();
  await page.getByRole('dialog', { name: '专注模式', exact: true }).waitFor();
  await page.evaluate(() => { window.realDateNow = Date.now; Date.now = () => window.realDateNow() + 61000; });
  await page.getByRole('button', { name: '取消打卡专注测试', exact: true }).waitFor();
  await page.evaluate(() => { Date.now = window.realDateNow; delete window.realDateNow; });
  assert.equal((await api('/planner')).checks.filter(check => check.item_id === focusItem.id).length, 1);
  await page.getByRole('button', { name: '打卡统计', exact: true }).click();
  await page.getByRole('button', { name: '最近30天', exact: true }).click();
  await page.getByRole('img', { name: '最近30天每日打卡次数', exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/habit-stats.png' });
  await page.getByRole('dialog', { name: '打卡统计', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.planner-habit-body').filter({ hasText: '专注测试' }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await views.getByRole('tab', { name: '课程', exact: true }).click();
  await page.getByRole('button', { name: '代课记录', exact: true }).waitFor();
  assert.equal(await page.locator('.course-controls .planner-icon').count(), 0);
  await page.getByRole('button', { name: '代课记录', exact: true }).click();
  await page.getByText('请选择班级', { exact: true }).waitFor();
  assert.equal(await page.locator('.planner-course-grid').count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: '我的授课', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '作息与提醒', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '设置授课姓名', exact: true }).count(), 0);
  assert.equal(await page.locator('.course-summary').innerText(), '今日 0 节\n已上 0\n剩余 0');
  assert.equal(await page.locator('.course-now').innerText(), '当前：无课\n下一节：今日无后续课程');
  await page.getByRole('button', { name: '添加周四第5节课程', exact: true }).click();
  await page.getByLabel('我的授课姓名', { exact: true }).waitFor();
  assert.equal(await page.locator('.course-editor .error-box').count(), 0);
  await page.getByRole('switch', { name: '课前提醒', exact: true }).scrollIntoViewIfNeeded();
  const reminderScroll = await page.locator('.course-editor .record-form').evaluate(el => el.scrollTop);
  await page.getByRole('switch', { name: '课前提醒', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '请先填写我的授课姓名' }).waitFor();
  assert.equal(await page.locator('.course-editor .error-box').count(), 0);
  assert.equal(await page.locator('.course-editor .record-form').evaluate(el => el.scrollTop), reminderScroll);
  assert.equal(await page.getByLabel('我的授课姓名', { exact: true }).evaluate(el => el === document.activeElement), false);
  await page.getByRole('status').filter({ hasText: '请先填写我的授课姓名' }).waitFor({ state: 'hidden', timeout: 8000 });
  assert.equal(await page.getByRole('switch', { name: '课前提醒', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('授课老师', { exact: true }).count(), 0);
  assert.equal(await page.locator('.course-empty-slot').count(), 49);
  await page.screenshot({ path: 'artifacts/course-mine-empty-grid-390.png' });
  await page.getByRole('button', { name: '添加周四第5节课程', exact: true }).click();
  await page.getByRole('dialog', { name: '作息与提醒', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '请填写我的授课姓名' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '班级课表', exact: true }).click();
  assert.equal(await page.locator('.course-empty-slot').count(), 49);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('.planner-course-grid').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/course-empty-grid-${width}.png` });
  }
  await page.getByRole('button', { name: '添加周二第3节课程', exact: true }).click();
  assert.equal(await page.getByLabel('历史记录', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('周二', { exact: true }).isChecked(), true);
  assert.equal(await page.locator('.planner-week-options input:checked').count(), 1);
  assert.equal(await page.getByLabel('课程顺序', { exact: true }).inputValue(), '3');
  assert.equal(await page.getByLabel('班级', { exact: true }).inputValue(), '');
  await page.getByLabel('课程名称').fill('空格新增课程');
  await page.getByLabel('班级', { exact: true }).fill('临时班');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '周二第3节 空格新增课程', exact: true }).waitFor();
  assert.equal(await page.getByLabel('班级选择', { exact: true }).inputValue(), '临时班');
  const cellCourse = (await api('/planner')).items.find(item => item.payload.title === '空格新增课程');
  assert.deepEqual(cellCourse.payload.weekdays, [1]);
  assert.equal(cellCourse.payload.order, 3);
  await page.getByRole('button', { name: '周二第3节 空格新增课程', exact: true }).click();
  await page.getByRole('button', { name: '编辑每周课程', exact: true }).click();
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('button', { name: '添加周二第3节课程', exact: true }).waitFor();
  await page.getByLabel('班级选择', { exact: true }).selectOption('');
  await page.getByRole('button', { name: '我的授课', exact: true }).click();
  const otherClassId = randomUUID();
  await api('/planner', { requestId: otherClassId, kind: 'course',
    payload: { title: '二班数学', className: '七年级二班', teacher: '赵老师', weekdays: [0], order: 1, tone: 'blue' } }, 'POST', 201);
  await createFromMenu('新建课程');
  assert.equal(await page.locator('.task-photos, input[type="file"]').count(), 0);
  await page.getByLabel('课程名称').fill('英语');
  await page.getByLabel('班级', { exact: true }).fill('七年级一班');
  await page.getByLabel('周一', { exact: true }).check();
  await page.getByLabel('教室', { exact: true }).fill('教学楼 302');
  await page.getByLabel('老师', { exact: true }).fill('陈老师');
  await page.getByLabel('课程顺序').fill('2');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.locator('.planner-course').count(), 0);
  await page.getByRole('button', { name: '班级课表', exact: true }).click();
  assert.equal(await page.locator('.course-summary, .course-now').count(), 2);
  assert.equal(await page.locator('.course-summary strong').innerText(), '0');
  assert.equal(await page.locator('.course-empty-slot').count(), 49);
  assert.equal(await page.getByLabel('班级选择', { exact: true }).locator('option').filter({ hasText: '全部班级' }).count(), 0);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级一班');
  await page.getByRole('button', { name: '周一第2节 英语', exact: true }).waitFor();
  await page.getByRole('button', { name: '添加周三第4节课程', exact: true }).click();
  assert.equal(await page.getByLabel('班级', { exact: true }).inputValue(), '七年级一班');
  assert.equal(await page.getByLabel('周三', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('课程顺序', { exact: true }).inputValue(), '4');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '周一第1节 二班数学', exact: true }).count(), 0);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级二班');
  await page.getByRole('button', { name: '周一第1节 二班数学', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '周一第2节 英语', exact: true }).count(), 0);
  await page.getByLabel('班级选择', { exact: true }).selectOption('');
  assert.equal(await page.locator('.course-summary, .course-now').count(), 2);
  assert.equal(await page.locator('.course-summary strong').innerText(), '0');
  assert.equal(await page.locator('.course-empty-slot').count(), 49);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级一班');
  await page.getByRole('button', { name: '我的授课', exact: true }).click();
  await page.getByRole('button', { name: '添加周四第5节课程', exact: true }).click();
  await page.getByLabel('我的授课姓名', { exact: true }).fill('陈老师');
  assert.equal(await page.getByRole('switch', { name: '课前提醒', exact: true }).isChecked(), false);
  assert.equal(await page.getByRole('switch', { name: '课前提醒', exact: true }).isEnabled(), true);
  await page.getByRole('switch', { name: '课前提醒', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '请先勾选“已核对作息时间”' }).waitFor();
  assert.equal(await page.getByRole('switch', { name: '课前提醒', exact: true }).isChecked(), false);
  await page.getByLabel('已核对作息时间', { exact: true }).check();
  await page.getByRole('switch', { name: '课前提醒', exact: true }).check();
  await page.getByLabel('提前分钟数', { exact: true }).waitFor();
  await page.getByRole('switch', { name: '课前提醒', exact: true }).uncheck();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog', { name: '作息与提醒', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '新建课程', exact: true }).waitFor();
  assert.equal(await page.getByLabel('周四', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('课程顺序', { exact: true }).inputValue(), '5');
  assert.equal(await page.getByLabel('老师', { exact: true }).inputValue(), '陈老师');
  assert.equal(await page.getByLabel('班级', { exact: true }).inputValue(), '七年级一班');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '添加周五第6节课程', exact: true }).click();
  const historySource = (await api('/planner')).items.find(item => item.payload.title === '英语');
  await page.getByLabel('历史记录', { exact: true }).selectOption(historySource.id);
  assert.equal(await page.getByLabel('课程名称', { exact: true }).inputValue(), '英语');
  assert.equal(await page.getByLabel('班级', { exact: true }).inputValue(), '七年级一班');
  assert.equal(await page.getByLabel('教室', { exact: true }).inputValue(), '教学楼 302');
  assert.equal(await page.locator('.planner-week-options input:checked').count(), 1);
  assert.equal(await page.getByRole('dialog', { name: '作息与提醒', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('周五', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('课程顺序', { exact: true }).inputValue(), '6');
  assert.equal(await page.getByLabel('老师', { exact: true }).inputValue(), '陈老师');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await api('/planner')).courseSettings.myTeacher, '陈老师');
  assert.equal((await api('/planner')).courseSettings.reminders, false);
  assert.deepEqual((await api('/planner')).items.find(item => item.id === historySource.id), historySource);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级二班');
  assert.equal(await page.locator('.planner-course').count(), 0);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级一班');
  for (const [width, height] of [[320, 640], [390, 844], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('.planner-course-grid').evaluate(table => {
      const firstCell = table.querySelector('tbody td').getBoundingClientRect();
      return [...table.querySelectorAll('thead th small')].every(date => {
        const header = date.parentElement.getBoundingClientRect();
        return date.getBoundingClientRect().bottom <= header.bottom && firstCell.top - header.bottom >= 4;
      });
    }), true, `Course dates stay inside headers and clear the first row at ${width}x${height}`);
    await page.screenshot({ path: `artifacts/course-compact-${width}.png` });
    assert.equal(await page.locator('.planner-course-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 1), false, `Course grid fits ${width}x${height}: ${await page.locator('.course-board').evaluate(el => JSON.stringify([...el.children].map(child => [child.className, child.getBoundingClientRect().height])))}`);
    for (const mode of ['班级课表', '我的授课']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      assert.equal(await page.locator('.course-filters').evaluate(el => {
        const button = el.querySelector('.planner-today');
        const box = button.getBoundingClientRect();
        const previous = button.previousElementSibling.getBoundingClientRect();
        return box.width >= 44 && box.left >= previous.right
          && box.right <= el.getBoundingClientRect().right && button.scrollWidth <= button.clientWidth;
      }), true, `${mode} this-week button has reserved space at ${width}px`);
      assert.equal(await page.locator('.course-status-band').evaluate(el => {
        const grid = el.parentElement.querySelector('.planner-course-grid');
        return getComputedStyle(el).backgroundColor === 'rgb(240, 244, 248)'
          && grid.getBoundingClientRect().top - el.getBoundingClientRect().bottom >= 10;
      }), true, `${mode} status band has background and space above timetable`);
      assert.equal(await page.getByRole('button', { name: '作息与提醒', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '代课记录', exact: true }).isVisible(), true);
      assert.equal(await page.locator('.course-now').evaluate(el => {
        const [current, next] = [...el.children].map(child => child.getBoundingClientRect());
        return Math.abs(current.top - next.top) < 1 && next.left - current.right >= 8
          && next.right <= el.getBoundingClientRect().right;
      }), true, `${mode} current and next lessons share a row without overlap at ${width}px`);
      assert.equal(await page.locator('.course-filters').evaluate(el => {
        const box = el.getBoundingClientRect();
        return [...el.children].every(child => {
          const bounds = child.getBoundingClientRect();
          return bounds.top - box.top >= 8 && box.bottom - bounds.bottom >= 8;
        });
      }), true, `${mode} filters have vertical breathing room at ${width}px`);
      assert.equal(await page.locator('.planner-course-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 1), false);
      assert.equal(await page.locator('.planner-course-grid tbody tr').count(), 7);
      await page.screenshot({ path: `artifacts/course-spacing-${mode === '我的授课' ? 'mine' : 'class'}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await createFromMenu('新建课程');
  assert.equal(await page.getByLabel('老师', { exact: true }).inputValue(), '陈老师');
  await page.getByLabel('历史记录', { exact: true }).selectOption(historySource.id);
  assert.equal(await page.getByLabel('课程顺序', { exact: true }).inputValue(), '2');
  assert.equal(await page.getByLabel('周一', { exact: true }).isChecked(), true);
  await page.getByLabel('课程名称').fill('历史微调课程');
  await page.getByLabel('备注', { exact: true }).fill('历史填入后微调');
  await page.getByLabel('课程顺序', { exact: true }).fill('7');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '周一第7节 历史微调课程', exact: true }).click();
  await page.getByRole('button', { name: '编辑每周课程', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑课程', exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/course-history-edit.png' });
  assert.equal(await page.getByLabel('历史记录', { exact: true }).count(), 0);
  assert.equal(await page.locator('textarea[name="note"]').inputValue(), '历史填入后微调');
  assert.deepEqual((await api('/planner')).items.find(item => item.id === historySource.id), historySource);
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await createFromMenu('新建课程');
  assert.equal(await page.getByLabel('历史记录', { exact: true }).locator('option').filter({ hasText: '历史微调课程' }).count(), 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '周一第2节 英语', exact: true }).click();
  await page.getByLabel('教学进度与备课备注', { exact: true }).fill('讲到第二章，准备听力材料');
  assert.equal(await page.locator('.task-photos, input[type="file"]').count(), 0);
  await page.getByRole('button', { name: '保存本次', exact: true }).click();
  await page.getByRole('dialog', { name: '本次课程', exact: true }).waitFor({ state: 'hidden' });
  const courseEvent = (await api('/planner')).courseEvents.at(-1);
  assert.equal(courseEvent.payload.note, '讲到第二章，准备听力材料');
  assert.equal(courseEvent.payload.photos.length, 0);
  await page.getByRole('button', { name: '周一第2节 英语', exact: true }).click();
  await page.getByLabel('本次上课日期', { exact: true }).fill(shiftDate(courseEvent.source_date, 1));
  await page.getByLabel('本次节次', { exact: true }).fill('3');
  await page.getByLabel('本次授课老师', { exact: true }).fill('王老师');
  await page.getByLabel('变更原因', { exact: true }).fill('临时代课');
  await page.getByRole('button', { name: '保存本次', exact: true }).click();
  await page.getByRole('dialog', { name: '本次课程', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '周二第3节 英语', exact: true }).count(), 0);
  await page.getByRole('button', { name: '班级课表', exact: true }).click();
  await page.getByRole('button', { name: '周二第3节 英语', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '周一第2节 英语', exact: true }).count(), 0);
  await page.getByRole('button', { name: '周二第3节 英语', exact: true }).click();
  await page.getByLabel('本次停课', { exact: true }).check();
  await page.getByRole('button', { name: '保存本次', exact: true }).click();
  await page.getByRole('dialog', { name: '本次课程', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.planner-course').count(), 0);
  await page.getByRole('button', { name: '代课记录', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.planner-course-grid').count(), 0);
  assert.equal(await page.getByLabel('班级选择', { exact: true }).inputValue(), '七年级一班');
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级二班');
  await page.getByText('暂无代课记录', { exact: true }).waitFor();
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级一班');
  await page.screenshot({ path: 'artifacts/course-history-page.png' });
  await page.locator('.course-history-row').first().click();
  await page.getByRole('button', { name: '恢复原安排', exact: true }).click();
  await page.getByRole('button', { name: '保存本次', exact: true }).click();
  await page.getByRole('dialog', { name: '本次课程', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '我的授课', exact: true }).click();
  await page.getByRole('button', { name: '周一第2节 英语', exact: true }).waitFor();
  assert.equal((await api('/planner')).courseEvents.length, 4);
  await api(`/planner/${otherClassId}/remove`, { revision: 0 });
  assert.equal((await api('/planner')).items.find(item => item.kind === 'course').payload.time, undefined);
  // Re-enter the module to verify saved state is read back from the real isolated backend.
  await nav.getByRole('button', { name: '记账', exact: true }).click();
  await nav.getByRole('button', { name: '待办', exact: true }).click();
  await views.getByRole('tab', { name: '打卡', exact: true }).click();
  await page.getByRole('button', { name: '取消打卡每日阅读', exact: true }).waitFor();
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    let moduleHeading;
    for (const module of ['记账', '健康', '待办']) {
      await nav.getByRole('button', { name: module, exact: true }).click();
      const selector = module === '待办' ? '.planner-heading' : '.records-page>.page-heading';
      await page.locator(selector).waitFor();
      const metrics = await page.locator(selector).evaluate(el => {
        const title = el.querySelector('h1'), box = title.getBoundingClientRect(), band = el.getBoundingClientRect();
        return { x: box.x, y: box.y, fontSize: getComputedStyle(title).fontSize,
          background: getComputedStyle(el).backgroundColor, bandX: band.x, bandWidth: band.width, bandHeight: band.height };
      });
      moduleHeading ??= metrics;
      assert.deepEqual(metrics, moduleHeading, `${module} heading matches ledger at ${width}px`);
      await page.screenshot({ path: `artifacts/module-heading-${module === '记账' ? 'ledger' : module === '健康' ? 'health' : 'planner'}-${width}.png` });
    }
    let headingGeometry;
    for (const [view, key] of [['清单', 'list'], ['待办', 'calendar'], ['打卡', 'habits'], ['课程', 'courses']]) {
      if (key === 'list') await showList();
      else await views.getByRole('tab', { name: view, exact: true }).click();
      await page.getByRole('tabpanel').waitFor();
      assert.equal(await page.locator('.planner-heading button').count(), 0);
      const heading = await page.locator('.planner-heading h1').evaluate(el => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { x: box.x, y: box.y, height: box.height, fontSize: style.fontSize, fontWeight: style.fontWeight };
      });
      headingGeometry ??= heading;
      assert.deepEqual(heading, headingGeometry, `Planner headings match across views at ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const scrollArea = page.locator(key === 'calendar' ? '.planner-month-board' : '.planner-scroll');
      assert(await scrollArea.evaluate(el => el.clientHeight) > 100);
      assert(await page.locator('.planner-views button>span').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height < 28)));
      const headerTop = await page.locator('.planner-heading').evaluate(el => el.getBoundingClientRect().top);
      await scrollArea.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.equal(await page.locator('.planner-heading').evaluate(el => el.getBoundingClientRect().top), headerTop);
      await scrollArea.evaluate(el => { el.scrollTop = 0; });
      if (key === 'calendar') {
        assert.equal(await page.locator('.planner-day-number[aria-current=date]').evaluate(el => {
          const circle = getComputedStyle(el, '::before');
          return Math.abs(parseFloat(circle.width) - parseFloat(circle.height)) < 0.1 && circle.borderRadius === '50%';
        }), true, `Today highlight stays circular at ${width}px`);
        const todayBounds = await page.getByRole('button', { name: '今天', exact: true }).boundingBox();
        const listButton = page.getByRole('button', { name: '清单', exact: true });
        const listBounds = await listButton.boundingBox();
        assert(listBounds.x >= todayBounds.x + todayBounds.width);
        assert(Math.abs(listBounds.y - todayBounds.y) < 1);
        assert.equal(await listButton.innerText(), '');
        assert.equal(await listButton.locator('svg').count(), 1);
        assert((await api('/planner')).items.some(item => item.payload.title === '我们的纪念日'));
        assert.equal(await page.locator('.planner-month-board').evaluate(el => el.scrollWidth > el.clientWidth), false);
      }
      await page.screenshot({ path: `artifacts/planner-${key}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await views.getByRole('tab', { name: '待办', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'artifacts/planner-calendar-desktop.png' });
  await page.setViewportSize({ width: 430, height: 844 });
  await views.getByRole('tab', { name: '课程', exact: true }).click();
  assert.equal(await page.locator('.planner-course-grid thead th').count(), 8);
  assert.equal(await page.locator('.planner-course-grid tbody tr').count(), 7);
  await page.getByLabel('班级选择', { exact: true }).selectOption('七年级一班');
  await page.locator('.planner-course').first().click();
  await page.getByRole('button', { name: '编辑每周课程', exact: true }).click();
  assert.equal(await page.locator('.task-photos, input[type="file"]').count(), 0);
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('button', { name: '添加周一第2节课程', exact: true }).waitFor();
  assert.equal(await page.locator('.course-empty-slot').count(), 49);
  await views.getByRole('tab', { name: '打卡', exact: true }).click();
  await page.getByRole('button', { name: '取消打卡每日阅读', exact: true }).click();
  assert.equal((await api('/planner')).checks.length, 0);
  await page.setViewportSize({ width: 320, height: 640 });
  await createFromMenu('新建目标');
  await page.getByRole('dialog', { name: '新建目标', exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/planner-habit-form-320.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await views.getByRole('tab', { name: '待办', exact: true }).click();
  assert(await page.locator('.planner-month-board').evaluate(el => el.clientHeight) >= 110);
  await page.screenshot({ path: 'artifacts/planner-calendar-short-320.png' });
  await page.getByRole('button', { name: `查看${today}详情`, exact: true }).click();
  await page.getByRole('dialog', { name: today, exact: true }).getByRole('button', { name: '我们的纪念日', exact: true }).click();
  await page.getByRole('button', { name: '删除纪念日', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('button', { name: '编辑纪念日我们的纪念日', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await api('/planner')).items.some(item => item.kind === 'anniversary'), false);
  await showList();
  await page.getByRole('button', { name: '编辑手动选择的计划', exact: true }).click();
  await page.getByLabel('要做的事', { exact: true }).fill('这是用于验证手机窄屏长标题排版的待办事项不会挤压完成按钮或更多操作按钮');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.planner-task-body').filter({ hasText: '这是用于验证手机窄屏' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'artifacts/planner-long-title-320.png' });
  const habitId = (await api('/planner')).items.find(item => item.kind === 'habit').id;
  await api(`/planner/${habitId}/check`, { date: shiftDate(today, 1), checked: true }, 'POST', 400);
  const other = (await api('/register', { username: 'planner-other', name: '其他', birthday: '2000-01-01', password: 'planner-password-123', invite: 'planner-test' })).token;
  assert.equal((await api('/planner', null, 'GET', 200, other)).items.length, 0);
  await api(`/planner/${habitId}/check`, { date: today, checked: true }, 'POST', 404, other);
  const previewDate = '2026-09-16';
  for (let index = 1; index <= 8; index++) {
    await api('/records', { kind: 'task', confirmed: true, payload: {
      title: `预览测试计划${index}`, category: '工作', scheduledDate: previewDate, priority: 'low',
      due: index <= 2 ? `${previewDate}T${index === 1 ? '18' : '09'}:00:00+08:00` : null,
      note: index === 8 ? '这是超出日历六条上限的完整计划，仍可在预览中查看。' : '',
    } }, 'POST', 201);
  }
  await api('/planner', { kind: 'anniversary', requestId: randomUUID(),
    payload: { title: '预览纪念日', date: previewDate, calendar: 'solar', repeat: 'once', tone: 'rose' } }, 'POST', 201);
  for (const [index, priority] of ['high', 'important', 'urgent', 'low'].entries()) {
    await api('/records', { kind: 'task', confirmed: true, payload: {
      title: '角标颜色测试', category: '工作', scheduledDate: `2026-09-0${index + 6}`, priority,
    } }, 'POST', 201);
  }
  await api('/planner', { kind: 'anniversary', requestId: randomUUID(),
    payload: { title: '独立纪念日', date: '2026-09-10', calendar: 'solar', repeat: 'once', tone: 'rose' } }, 'POST', 201);
  for (const month of ['2026-02', '2026-08']) {
    for (let index = 1; index <= 7; index++) await api('/records', { kind: 'task', confirmed: true, payload: {
      title: `固定六条计划${index}`, category: '生活', scheduledDate: `${month}-16`, priority: 'low',
    } }, 'POST', 201);
  }
  await page.reload();
  await nav.getByRole('button', { name: '待办', exact: true }).click();
  await views.getByRole('tab', { name: '待办', exact: true }).click();
  await chooseMonth('2026-09');
  for (const [date, priority] of [['06', 'high'], ['07', 'important'], ['08', 'urgent'], ['09', 'low'], ['10', 'anniversary'], ['11', 'empty']]) {
    const corner = page.locator(`[data-date="2026-09-${date}"] .planner-cell-more`);
    await page.waitForFunction(({ date, priority }) => document.querySelector(`[data-date="2026-09-${date}"] .planner-cell-more`)?.dataset.priority === priority, { date, priority });
    assert.equal(await corner.locator('svg').count(), 0);
  }
  const cell = page.locator(`[data-date="${previewDate}"]`);
  for (const [width, height] of [[320, 640], [390, 844], [430, 844], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const capacity = Number(await page.locator('.planner-month-grid').getAttribute('data-capacity'));
    assert.equal(capacity, 6);
    assert.equal(await page.locator('.planner-category-trigger').count(), 0);
    assert.equal(await cell.evaluate(el => {
      const event = el.querySelector('.planner-calendar-event');
      return !event || parseFloat(getComputedStyle(event).fontSize) <= parseFloat(getComputedStyle(el.querySelector('.planner-lunar-label')).fontSize);
    }), true);
    assert.equal(await cell.locator('.planner-calendar-event').count(), capacity);
    assert.equal(await cell.locator('.planner-cell-count').textContent(), '9项');
    if (capacity > 0) {
      assert.equal(await cell.locator('.planner-calendar-event').first().getAttribute('aria-label'), '编辑预览测试计划2');
      assert.equal(await cell.locator('.planner-calendar-event time').first().textContent(), '09:00');
    }
    if (capacity > 1) assert.equal(await cell.locator('.planner-calendar-event time').nth(1).textContent(), '18:00');
    assert.equal(await page.locator('[data-date="2026-09-11"] .planner-cell-count').count(), 0);
    assert.equal(await page.locator('.planner-month-board').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true);
    assert.equal(await cell.evaluate(el => {
      const entries = [...el.querySelectorAll('.planner-calendar-event')].map(item => item.getBoundingClientRect());
      const corner = el.querySelector('.planner-cell-more').getBoundingClientRect();
      return (!entries.length || entries.at(-1).bottom <= corner.top) &&
        entries.every((rect, index) => index === 0 || rect.top >= entries[index - 1].bottom);
    }), true);
    await page.screenshot({ path: `artifacts/calendar-fit-month-${width}.png` });
    await cell.getByRole('button', { name: `查看${previewDate}详情`, exact: true }).click();
    const preview = page.getByRole('dialog', { name: previewDate, exact: true });
    assert.equal(await preview.locator('.planner-task').count(), 8);
    await preview.getByRole('button', { name: '预览纪念日', exact: true }).waitFor();
    assert.equal(await preview.locator('input[type="time"]').count(), 0);
    assert.equal(await preview.locator('.planner-almanac-meta>span').count(), 6);
    assert.equal(await preview.locator('.planner-almanac-fortune>div').count(), 2);
    assert.equal(await preview.evaluate(el => el.classList.contains('fullscreen-modal')), false);
    await page.screenshot({ path: `artifacts/calendar-day-preview-${width}.png` });
    assert.equal(await preview.evaluate(el => el.scrollWidth > el.clientWidth), false, JSON.stringify(await preview.evaluate(el => ({
      width: el.clientWidth, scrollWidth: el.scrollWidth,
      children: [...el.children].map(child => ({ className: child.className, width: child.getBoundingClientRect().width, margin: getComputedStyle(child).margin })),
    }))));
    const headingTop = await preview.locator('.modal-heading').evaluate(el => el.getBoundingClientRect().top);
    const actionsBottom = await preview.locator(':scope>.modal-actions').evaluate(el => el.getBoundingClientRect().bottom);
    await preview.locator('.planner-day-preview-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await preview.locator('.modal-heading').evaluate(el => el.getBoundingClientRect().top), headingTop);
    assert.equal(await preview.locator(':scope>.modal-actions').evaluate(el => el.getBoundingClientRect().bottom), actionsBottom);
    await preview.locator('.planner-day-preview-body').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/calendar-day-preview-${width}.png` });
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await views.getByRole('tab', { name: '待办', exact: true }).getAttribute('aria-selected'), 'true');
  }
  // Four-, five- and six-week months must fit without hiding the last date or corner.
  for (const [width, height] of [[320, 640], [390, 844], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    for (const month of ['2026-02', '2026-09', '2026-08']) {
      await chooseMonth(month);
      await page.waitForTimeout(100);
      const filledDay = page.locator(`[data-date="${month}-16"]`);
      assert.equal(await page.locator('.planner-month-cell').evaluateAll(cells => cells.every(cell =>
        getComputedStyle(cell).backgroundColor === (cell.classList.contains('outside') ? 'rgb(245, 246, 247)' : 'rgba(0, 0, 0, 0)')
      )), true, 'Only adjacent-month dates have pale gray backgrounds');
      assert.equal(await page.locator('.planner-month-cell').evaluateAll((cells, today) => cells.every(cell => {
        const background = getComputedStyle(cell).backgroundImage;
        return cell.dataset.date === today ? background.startsWith('linear-gradient(to top,') : background === 'none';
      }), today), true, 'Only the actual current day has a bottom-to-top gradient, regardless of selection');
      assert.equal(await page.locator('.planner-lunar-label').evaluateAll(labels => labels.every(label =>
        label.getBoundingClientRect().width >= parseFloat(getComputedStyle(label).fontSize) * 3 - 0.1
      )), true, `At least three Chinese characters fit: ${month} at ${width}x${height}`);
      if (month === '2026-09') {
        const festival = page.locator('[data-date="2026-09-25"]');
        assert.equal(await festival.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      }
      assert.equal(await page.locator('.planner-cell-date').evaluateAll(headers => headers.every(header => {
        const badge = header.querySelector('.planner-holiday-badge');
        if (!badge) return true;
        const mark = badge.getBoundingClientRect();
        return ['.planner-day-number', '.planner-lunar-label'].every(selector => {
          const text = header.querySelector(selector).getBoundingClientRect();
          return text.right <= mark.left || text.bottom <= mark.top || text.top >= mark.bottom;
        });
      })), true, `Date labels do not overlap holiday badges: ${month} at ${width}x${height}: ${JSON.stringify(await page.locator('.planner-cell-date:has(.planner-holiday-badge)').evaluateAll(headers => headers.map(header => ({
        date: header.closest('[data-date]').dataset.date,
        label: header.querySelector('.planner-lunar-label').getBoundingClientRect().toJSON(),
        badge: header.querySelector('.planner-holiday-badge').getBoundingClientRect().toJSON(),
      }))))}`);
      assert.equal(await page.locator('.planner-holiday-badge').evaluateAll(badges => badges.every(badge => {
        const bounds = badge.getBoundingClientRect();
        const cell = badge.closest('.planner-month-cell').getBoundingClientRect();
        const style = getComputedStyle(badge);
        return bounds.width >= 11 && Math.abs(bounds.width - bounds.height) < 0.1 &&
          parseFloat(style.fontSize) >= 9 && style.borderRadius === '50%' &&
          bounds.right <= cell.right && bounds.top >= cell.top;
      })), true, `Holiday badges are larger, circular and inside their cells: ${month} at ${width}x${height}`);
      assert.equal(await filledDay.locator('.planner-calendar-event').count(), 6);
      assert.equal(await filledDay.locator('.planner-cell-more').evaluate(button => {
        const triangle = getComputedStyle(button, '::before');
        const width = parseFloat(triangle.width), height = parseFloat(triangle.height);
        return width > 0 && height > 0 && triangle.right === '0px' && triangle.bottom === '0px' &&
          triangle.clipPath === 'polygon(100% 0px, 100% 100%, 0px 100%)' && !button.querySelector('svg');
      }), true, `Bottom-right preview corner without arrow: ${month} at ${width}x${height}`);
      assert.equal(await filledDay.evaluate(el => {
        const events = [...el.querySelectorAll('.planner-calendar-event')];
        const date = el.querySelector('.planner-cell-date').getBoundingClientRect();
        const footer = el.querySelector('.planner-cell-footer').getBoundingClientRect();
        const cell = el.getBoundingClientRect();
        const festivalSize = parseFloat(getComputedStyle(el.querySelector('.planner-lunar-label')).fontSize);
        return events.every((event, index) => {
          const rect = event.getBoundingClientRect();
          return parseFloat(getComputedStyle(event).fontSize) <= festivalSize &&
            rect.top >= (index ? events[index - 1].getBoundingClientRect().bottom : date.bottom) &&
            rect.bottom <= footer.top && rect.bottom <= cell.bottom;
        });
      }), true, `Six complete, non-overlapping entries: ${month} at ${width}x${height}`);
      assert.equal(await page.locator('.planner-month-board').evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth &&
          [...el.querySelectorAll('.planner-cell-more')].every(button => {
            const rect = button.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1;
          });
      }), true);
      await page.screenshot({ path: `artifacts/calendar-fit-${month}-${width}.png` });
    }
    await page.getByLabel('日历月份').click();
    assert.equal(await page.locator('.unified-date-dialog .date-wheel').evaluateAll(wheels => wheels.length === 2 && wheels.every(wheel => {
      const selected = wheel.querySelector('[aria-selected=true]');
      const bounds = wheel.getBoundingClientRect(), item = selected.getBoundingClientRect();
      return Math.abs((item.top + item.bottom) / 2 - (bounds.top + bounds.bottom) / 2) < 1 &&
        bounds.height === 200 && getComputedStyle(selected).fontSize === '18px';
    })), true, 'Both wheels center and enlarge the selected value');
    await page.screenshot({ path: `artifacts/calendar-month-picker-${width}.png` });
    assert.equal(await page.getByRole('dialog', { name: '选择月份', exact: true }).evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.getByRole('button', { name: '返回', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('button', { name: '我的', exact: true }).click();
  for (const [width, height] of [[320, 640], [390, 844], [1280, 640]]) {
    await page.setViewportSize({ width, height });
    const menu = page.locator('.mine-menu-scroll');
    await menu.evaluate(el => { el.scrollTop = 0; });
    const headingBefore = await page.locator('.mine-page-heading').boundingBox();
    const heroBefore = await page.locator('.mine-hero').boundingBox();
    const rowBefore = await page.locator('.mine-menu-row').first().boundingBox();
    await menu.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await menu.evaluate(el => el.scrollTop > 0), 'Mine menu scrolls independently');
    assert.deepEqual(await page.locator('.mine-page-heading').boundingBox(), headingBefore);
    assert.deepEqual(await page.locator('.mine-hero').boundingBox(), heroBefore);
    assert.ok((await page.locator('.mine-menu-row').first().boundingBox()).y < rowBefore.y);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      'Mine home does not scroll the document');
    await page.screenshot({ path: `artifacts/mine-fixed-header-${width}.png` });
    await menu.evaluate(el => { el.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByText('暂无系统消息', { exact: true }).waitFor();
  await api('/feedback', { requestId: randomUUID(), category: '功能建议', content: '消息页面功能测试', contact: '' }, 'POST', 201);
  await page.getByRole('button', { name: '刷新消息', exact: true }).click();
  await page.getByRole('button', { name: '意见反馈已提交，未读', exact: true }).click();
  await page.getByRole('button', { name: '返回我的', exact: true }).click();
  await page.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByRole('button', { name: '意见反馈已提交，已读', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回我的', exact: true }).click();
  await page.locator('.mine-menu').getByRole('button', { name: '设置', exact: true }).click();
  const ringtoneRow = page.getByRole('button', { name: '提醒铃声 手机端设置', exact: true });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await ringtoneRow.scrollIntoViewIfNeeded();
    assert.equal(await ringtoneRow.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/reminder-sound-settings-${width}.png` });
  }
  await ringtoneRow.click();
  const ringtoneDialog = page.getByRole('dialog', { name: '提醒铃声', exact: true });
  await ringtoneDialog.getByText(/网页版无法读取手机自带铃声/).waitFor();
  assert.equal(await ringtoneDialog.getByRole('radio').count(), 0);
  await ringtoneDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '声音与触感', exact: true }).click();
  await page.getByRole('checkbox', { name: '按键音', exact: true }).waitFor();
  await page.getByRole('dialog', { name: '声音与触感', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  const menus = [
    ['记账', '', '添加记账', ['记一笔', '小票识别'], '记一笔'],
    ['健康', '', '添加健康记录', ['记录体重'], '记录体重'],
    ['我的', '', '添加', ['记一笔', '添加待办', '记录体重', '小票识别'], '记一笔'],
    ['待办', '日历', '添加日程', ['添加待办', '添加纪念日'], '添加待办'],
    ['待办', '清单', '添加日程', ['添加待办'], '添加待办'],
    ['待办', '打卡', '添加打卡目标', ['新建目标'], '新建目标'],
    ['待办', '课程表', '添加课程', ['新建课程'], '新建课程'],
  ];
  const countBefore = (await api('/state')).records.length;
  for (const width of [320, 390, 430, 1280]) {
    let reference;
    for (const [section, view, title, choices, formTitle] of menus) {
      await page.setViewportSize({ width: Math.min(width, 430), height: 844 });
      await nav.getByRole('button', { name: section, exact: true }).click();
      if (view === '清单') await showList();
      else if (view) await views.getByRole('tab', { name: view, exact: true }).click();
      await nav.locator('.nav-create').click();
      const menu = page.getByRole('dialog', { name: title, exact: true });
      await menu.waitFor();
      await page.setViewportSize({ width, height: 844 });
      assert.deepEqual(await menu.locator('.add-menu-options>button').allTextContents(), choices);
      assert.equal(await menu.locator('input,textarea,select').count(), 0);
      assert.equal(await menu.locator('.add-menu-options svg').count(), choices.length);
      const style = await menu.locator('.add-menu-options>button').first().evaluate(el => {
        const css = getComputedStyle(el);
        return { font: css.fontSize, gap: css.gap, height: el.getBoundingClientRect().height };
      });
      if (reference) assert.deepEqual(style, reference);
      else reference = style;
      assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.screenshot({ path: `artifacts/add-menu-${section}-${view || 'main'}-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.add-menu').count(), 0);
      await page.setViewportSize({ width: Math.min(width, 430), height: 844 });
      await nav.locator('.nav-create').click();
      await page.locator('.add-menu').getByRole('button', { name: choices[0], exact: true }).click();
      const form = page.getByRole('dialog', { name: formTitle, exact: true });
      await form.waitFor();
      assert.equal(await page.locator('.add-menu').count(), 0);
      await form.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
  assert.equal((await api('/state')).records.length, countBefore, 'Opening or cancelling creation menus never writes records');
  assert.deepEqual(errors, []);
  console.log('PASS: task filters/calendar/editing and AI manual priority, habitual checks/history/persistence, weekday courses/edit/delete, user isolation, system messages, and 12 mobile screenshots. Only temporary test data used.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await stopped;
  }
  await new Promise(resolve => provider.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
