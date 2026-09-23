import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { plannerToday, weekday } from '../shared/planner.mjs';
import { defaultCourseSettings } from '../shared/courses.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
const today = plannerToday();
const data = { user: { id: 'widget-test', name: '测试', persona: 'gentle' }, messages: [], memories: [],
  records: [{ id: 't1', kind: 'task', status: 'confirmed', payload: { title: '核对采购单', scheduledDate: today } }] };
const planner = { items: [{ id: 'c', kind: 'course', payload: { title: '语文', weekdays: [weekday(today)], order: 1, className: '一班', teacher: '王老师' } }],
  courseEvents: [], courseSettings: { ...defaultCourseSettings(), myTeacher: '王老师' } };
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url()); });
    await page.addInitScript(() => localStorage.setItem('zaizai-token', 'fixture'));
    await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/state') ? data : planner }));
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('tab', { name: '工具箱', exact: true }).click();
    await page.getByRole('button', { name: '桌面小组件 · 待办与课程' }).click();
    assert.equal(await page.getByRole('switch', { name: '桌面显示具体内容' }).isChecked(), false);
    assert.equal(await page.getByRole('switch', { name: '待办', exact: true }).isChecked(), false);
    await page.getByRole('switch', { name: '待办', exact: true }).check();
    await page.getByRole('switch', { name: '桌面显示具体内容' }).check();
    await page.getByText('核对采购单', { exact: true }).first().waitFor();
    await page.getByRole('switch', { name: '课程提醒', exact: true }).check();
    await page.getByRole('button', { name: '刷新组件', exact: true }).click();
    await page.getByText('语文', { exact: true }).first().waitFor();
    for (const label of ['7天视图', '日程列表', '月历和日程']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true');
    }
    assert.equal(await page.locator('.desktop-widget-settings input[type="text"]').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `artifacts/widgets-settings-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '添加到桌面', exact: true }).first().click();
    assert.match(await page.getByRole('status').innerText(), /安卓或 iPhone/);
    await page.getByRole('switch', { name: '桌面显示具体内容' }).uncheck();
    assert.equal(await page.getByText('核对采购单', { exact: true }).count(), 0);
    await page.reload();
    await page.getByRole('tab', { name: '工具箱', exact: true }).click();
    await page.getByRole('button', { name: '桌面小组件 · 待办与课程' }).click();
    assert.equal(await page.getByRole('switch', { name: '待办', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('switch', { name: '桌面显示具体内容' }).isChecked(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    await page.close();
  }
  console.log('PASS: widget configuration, privacy masking, real-data previews, settings persistence and three viewport sizes; no API writes.');
} finally { await browser.close(); }
