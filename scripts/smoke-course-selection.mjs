import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { defaultCourseSettings } from '../shared/courses.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    let planner = { items: [], checks: [], courseEvents: [], courseSettings: defaultCourseSettings() };
    let saved;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('zaizai-token', 'fixture'));
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/course-batch')) {
        saved = route.request().postDataJSON();
        planner = { ...planner, items: saved.entries.map(entry => ({ ...entry, id: entry.requestId, revision: 0, created: new Date().toISOString() })) };
      }
      return route.fulfill({ json: route.request().url().endsWith('/state')
        ? { user: { id: 'course-selection', name: '测试', persona: 'gentle' }, records: [], messages: [], memories: [] } : planner });
    });
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('navigation', { name: '主要功能' }).getByRole('button', { name: '待办', exact: true }).count().then(async count => {
      const nav = width < 768 ? page.locator('.mobile-nav') : page.getByRole('navigation', { name: '主要功能' });
      await nav.getByRole('button', { name: '待办', exact: true }).click();
    });
    await page.getByRole('tab', { name: '课程', exact: true }).click();
    async function assertUnifiedEditor() {
      const editor = page.getByRole('dialog', { name: '新建课程', exact: true });
      await editor.waitFor();
      assert.equal(await editor.getByText('周日期', { exact: true }).count(), 1);
      assert.ok(await editor.locator('.record-form').evaluate(form => form.scrollHeight <= form.clientHeight + 1), 'default course form fits without scrolling');
      assert.ok(await editor.locator('.record-form').evaluate(form => {
        const actions = form.querySelector('.modal-actions').getBoundingClientRect();
        return form.getBoundingClientRect().bottom - actions.bottom < 25;
      }), 'save actions use the available bottom space');
      assert.equal(await editor.locator('.course-period-options input').count(), 7);
      assert.equal(await editor.locator('.course-week-circles input[type=radio]').count(), 7);
      assert.equal(await editor.getByRole('radio', { checked: true }).count(), 1);
      for (const label of ['历史记录', '课程名称', '课程类型', '课程年级', '班级', '教室', '老师', '备注']) {
        assert.equal(await editor.getByLabel(label, { exact: true }).count(), 1);
      }
      assert.equal(await page.getByRole('dialog', { name: '作息与提醒', exact: true }).count(), 0);
      const circles = await editor.locator('.course-week-circles span').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, radius: getComputedStyle(node).borderRadius };
      }));
      assert.ok(circles.every(circle => Math.abs(circle.width - circle.height) < 1 && circle.radius === '50%'));
      await editor.getByRole('button', { name: '取消', exact: true }).click();
    }
    await page.getByRole('button', { name: '我的授课', exact: true }).click();
    await page.getByRole('button', { name: '添加周一第1节课程', exact: true }).click();
    await assertUnifiedEditor();
    if (width < 768) {
      await page.locator('.mobile-nav .nav-create').click();
      await page.getByRole('button', { name: '新建课程', exact: true }).click();
      await assertUnifiedEditor();
    }
    await page.getByRole('button', { name: '班级课表', exact: true }).click();
    const boxes = await page.locator('.course-filters').locator('select,button').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { top: box.top, right: box.right, left: box.left };
    }));
    assert.ok(boxes.every(box => Math.abs(box.top - boxes[0].top) < 2));
    assert.ok(boxes.every((box, index) => !index || box.left >= boxes[index - 1].right));
    await page.screenshot({ path: `artifacts/course-filters-${width}.png` });
    await page.getByRole('button', { name: '课表周日期', exact: true }).click();
    await page.getByRole('dialog', { name: '课表周日期', exact: true }).getByRole('button', { name: '确定', exact: true }).click();
    await page.getByLabel('学段选择', { exact: true }).selectOption('小学');
    await page.getByLabel('年级选择', { exact: true }).selectOption('一年级');
    await page.getByRole('button', { name: '添加周一第1节课程', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建课程', exact: true });
    assert.equal(await dialog.locator('.course-period-options input').count(), 7);
    const circles = await dialog.locator('.course-week-circles span').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, radius: getComputedStyle(node).borderRadius };
    }));
    assert.ok(circles.every(circle => Math.abs(circle.width - circle.height) < 1 && circle.radius === '50%'));
    await dialog.getByLabel('课程名称', { exact: true }).fill('语文');
    await dialog.getByLabel('班级', { exact: true }).fill('一班');
    assert.equal(await dialog.getByLabel('课程类型', { exact: true }).inputValue(), '小学');
    await dialog.getByRole('radio', { name: '周二', exact: true }).check();
    assert.equal(await dialog.getByRole('radio', { checked: true }).count(), 1);
    await dialog.getByRole('radio', { name: '周一', exact: true }).check();
    await dialog.getByRole('checkbox', { name: '第2节', exact: true }).check();
    await dialog.getByRole('checkbox', { name: '第3节', exact: true }).check();
    await page.screenshot({ path: `artifacts/course-selection-${width}.png` });
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(saved.entries.length, 3);
    assert.deepEqual(saved.entries.map(entry => entry.payload.order), [1, 2, 3]);
    assert.ok(saved.entries.every(entry => entry.payload.weekdays.length === 1 && entry.payload.grade === '一年级'));
    assert.equal(await page.locator('.planner-course').count(), 3);
    await page.getByLabel('学段选择', { exact: true }).selectOption('大学');
    assert.equal(await page.locator('.planner-course').count(), 0);
    assert.equal(await page.getByRole('table', { name: '每周课程表' }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: education filters, single weekday, multiple periods and three independent grid cells at three viewport sizes.');
} finally { await browser.close(); }
