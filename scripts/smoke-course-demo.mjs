import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { defaultCourseSettings } from '../shared/courses.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
const makeCourse = (id, title, weekdays, order, room, teacher = '林老师') => ({
  id, kind: 'course', revision: 0, created: '2026-09-01T00:00:00.000Z',
  payload: { title, weekdays, order, stage: '小学', grade: '五年级', className: '演示班', teacher, room, tone: 'blue', note: '', photos: [] },
});
const items = [
  makeCourse('demo-chinese-1', '语文', [0], 1, 'A101'),
  makeCourse('demo-chinese-2', '语文', [0], 2, 'A101'),
  makeCourse('demo-chinese-3', '语文', [0], 3, 'A101'),
  makeCourse('demo-math-1', '数学', [1], 2, 'A203', '李老师'),
  makeCourse('demo-math-2', '数学', [1], 3, 'A203', '李老师'),
  makeCourse('demo-english', '英语', [2], 1, 'B102', '陈老师'),
  makeCourse('demo-science', '科学', [2], 4, '实验室', '周老师'),
  makeCourse('demo-sports', '体育', [3], 5, '操场', '王老师'),
  makeCourse('demo-art', '美术', [4], 2, '艺术教室', '赵老师'),
  makeCourse('demo-class', '班会', [4], 6, 'A101'),
];
const planner = { items, checks: [], courseEvents: [], courseSettings: { ...defaultCourseSettings(), myTeacher: '林老师', confirmed: true } };
const state = { user: { id: 'course-demo', name: '课程演示', persona: 'gentle' }, records: [], messages: [], memories: [] };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'course-demo-fixture'));
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? state : planner }));
  await page.goto('http://127.0.0.1:5173/');
  await page.locator('.mobile-nav').getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('tab', { name: '课程', exact: true }).click();
  await page.getByRole('button', { name: '班级课表', exact: true }).click();
  await page.getByLabel('班级选择', { exact: true }).selectOption('演示班');
  await page.locator('.planner-course').first().waitFor();
  assert.equal(await page.locator('.planner-course').count(), 10);
  const continuous = await page.locator('.planner-course').evaluateAll(nodes => nodes.filter(node => node.textContent.includes('语文')).map(node => getComputedStyle(node).getPropertyValue('--tone')));
  assert.equal(new Set(continuous).size, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/course-demo-390.png', fullPage: true });
  await page.close();
  console.log('PASS: simulated course table with continuous same-color lessons');
} finally { await browser.close(); }
