import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWidgetSettings, widgetSnapshot } from '../shared/widgets.mjs';
import { defaultCourseSettings } from '../shared/courses.mjs';

const now = Date.parse('2026-09-23T08:00:00+08:00');
const task = (id, patch = {}) => ({ id, kind: 'task', status: 'confirmed', payload: { title: '采购纸张', scheduledDate: '2026-09-23' }, ...patch });
const settings = { ...defaultWidgetSettings(), tasks: true, courses: true, showContent: true };
test('widgets are disabled and private by default; never store tokens or private record payloads', () => {
  const snapshot = widgetSnapshot([task('1')], { items: [] }, defaultWidgetSettings(), now);
  assert.equal(snapshot.private, true);
  assert.deepEqual(snapshot.tasks.rows, []);
  assert.equal(snapshot.tasks.enabled, false);
  const visible = widgetSnapshot([task('1', { token: 'secret', note: 'private note' })], {}, settings, now);
  assert.ok(!JSON.stringify(visible).includes('secret'));
  assert.ok(!JSON.stringify(visible).includes('private note'));
});
test('today widget excludes completed, deleted, pending and other-day records, expires at midnight', () => {
  const snapshot = widgetSnapshot([task('1'), task('2', { completed: true }), task('3', { deleted_at: 'x' }),
    task('4', { status: 'pending' }), task('5', { payload: { title: 'later', scheduledDate: '2026-09-24' } })], {}, settings, now);
  assert.equal(snapshot.tasks.rows.length, 1);
  assert.equal(snapshot.expires, Date.parse('2026-09-24T00:00:00+08:00'));
  assert.equal(widgetSnapshot([task('5', { payload: { title: 'unscheduled' } })], {}, { ...settings, taskScope: 'all' }, now).tasks.rows.length, 1);
});
test('weekly task uses its next actual reminder date', () => {
  const recurring = task('r', { payload: { title: '周提醒', due: '2026-09-16T10:00:00+08:00', reminderRepeat: 'weekly', reminderDays: [3] } });
  assert.equal(widgetSnapshot([recurring], {}, settings, now).tasks.rows.length, 1);
});
test('linked snapshot exposes layout-ready agenda rows without widget-only input', () => {
  const snapshot = widgetSnapshot([task('t')], {}, { ...settings, taskScope: 'all', layout: 'month', source: 'tasks' }, now);
  assert.equal(snapshot.layout, 'month');
  assert.equal(snapshot.source, 'tasks');
  assert.equal(snapshot.agenda.rows[0].kind, 'task');
  assert.equal(snapshot.agenda.rows[0].date, '2026-09-23');
  assert.equal(snapshot.agenda.rows[0].color, '#ff9ab5');
});
test('courses use effective teacher and skip ended or cancelled lessons', () => {
  const courseSettings = { ...defaultCourseSettings(), confirmed: true, myTeacher: '我' };
  const course = { id: 'c', kind: 'course', payload: { title: '数学', weekdays: [2], order: 2, teacher: '我', className: '一班' } };
  const planner = { items: [course], courseSettings, courseEvents: [] };
  assert.equal(widgetSnapshot([], planner, settings, now).courses.rows[0].title, '数学');
  const event = { id: 'e', course_id: 'c', source_date: '2026-09-23', payload: { date: '2026-09-23', order: 2, teacher: '其他老师' } };
  const snapshot = widgetSnapshot([], { ...planner, courseEvents: [event] }, settings, now);
  assert.ok(!snapshot.courses.rows.some(row => row.detail.includes('2026-09-23')));
  assert.deepEqual(widgetSnapshot([], planner, { ...settings, showContent: false }, now).courses.rows, []);
});
