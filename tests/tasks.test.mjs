import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTasks, filterTasks } from '../src/tasks.js';
import { validateRecord } from '../server/domain.mjs';
import { parseTaskCategory } from '../server/task-classification.mjs';
import { TASK_CATEGORIES, taskCategory } from '../shared/task-categories.mjs';

const task = (id, due, completed = false) => ({ id, kind: 'task', status: 'confirmed', completed, payload: { due } });
test('tasks group by Shanghai plan date, sort by time and place unscheduled last', () => {
  const records = [
    task('none'), task('tomorrow', '2026-09-18T10:00:00+08:00'),
    task('today-late', '2026-09-17T18:00:00+08:00'),
    task('today-utc', '2026-09-16T17:00:00Z'),
    task('past', '2026-09-16T10:00:00+08:00'),
    task('done', '2026-09-17T08:00:00+08:00', true),
    { ...task('pending'), status: 'pending' },
    { ...task('deleted'), deleted_at: '2026-09-17' },
  ];
  const groups = groupTasks(records, false, new Date('2026-09-17T12:00:00+08:00'));
  assert.deepEqual(groups.map(g => g.label), ['9月16日', '今天', '明天', '未安排日期']);
  assert.deepEqual(groups[1].records.map(r => r.id), ['today-utc', 'today-late']);
  assert.deepEqual(groupTasks(records, true, new Date('2026-09-17T12:00:00+08:00'))[0].records.map(r => r.id), ['done']);
  assert.equal(records[0].id, 'none');
});
test('task labels handle year boundaries and empty lists', () => {
  const now = new Date('2026-12-31T23:30:00+08:00');
  assert.deepEqual(groupTasks([task('new-year', '2027-01-01T10:00:00+08:00'), task('old', '2025-01-01T10:00:00+08:00')], false, now).map(g => g.label), ['2025年1月1日', '明天']);
  assert.deepEqual(groupTasks([], false, now), []);
});
test('task filters use Shanghai reminder dates and Monday-start weeks across the year boundary', () => {
  const now = new Date('2026-01-04T16:05:00Z');
  const records = [
    task('today', '2026-01-04T16:01:00Z'),
    task('yesterday', '2026-01-04T15:59:00Z'),
    task('prior-month', '2025-12-31T12:00:00+08:00'),
    task('sunday', '2026-01-11T23:59:00+08:00'),
    task('next-monday', '2026-01-12T00:00:00+08:00'),
    task('no-date'), task('invalid', 'bad'),
    { ...task('deleted', '2026-01-05'), deleted_at: '2026-01-06' },
    { ...task('draft', '2026-01-05'), status: 'pending' },
  ];
  const ids = period => filterTasks(records, period, '', now).map(record => record.id);
  assert.deepEqual(ids('today'), ['today']);
  assert.deepEqual(ids('yesterday'), ['yesterday']);
  assert.deepEqual(ids('this-week'), ['today', 'sunday']);
  assert.deepEqual(ids('last-week'), ['yesterday', 'prior-month']);
  assert.deepEqual(ids('this-month'), ['today', 'yesterday', 'sunday', 'next-monday']);
  assert.deepEqual(ids('last-month'), ['prior-month']);
  assert.equal(ids('all').length, 7);
});
test('task categories are fixed, legacy records use other, and invalid AI output is rejected', () => {
  assert.equal(TASK_CATEGORIES.length, 24);
  assert.equal(new Set(TASK_CATEGORIES.map(item => item.label)).size, 24);
  for (const { label } of TASK_CATEGORIES) {
    assert.equal(validateRecord('task', { title: '分类测试', category: label }).category, label);
    assert.equal(parseTaskCategory(JSON.stringify({ category: label })), label);
  }
  assert.equal(validateRecord('task', { title: '旧待办' }).category, '其他');
  assert.equal(taskCategory(undefined).label, '其他');
  for (const category of ['红色', '', {}, [], false, 0]) assert.throws(() => validateRecord('task', { title: '测试', category }));
  for (const output of ['null', '[]', '工作', '{"category":"红色"}', '{"category":null}', '```json\n{"category":"工作"}\n```']) assert.throws(() => parseTaskCategory(output));
  const records = [{ ...task('work', '2026-09-19'), payload: { due: '2026-09-19', category: '工作' } }, task('legacy')];
  assert.deepEqual(filterTasks(records, 'all', '其他').map(record => record.id), ['legacy']);
  assert.deepEqual(filterTasks(records, 'today', '工作', new Date('2026-09-19T12:00:00+08:00')).map(record => record.id), ['work']);
  const detailed = TASK_CATEGORIES.map(({ label }) => ({ ...task(label), payload: { category: label } }));
  for (const { label } of TASK_CATEGORIES) {
    assert.deepEqual(filterTasks(detailed, 'all', label).map(item => item.id), [label]);
  }
});
