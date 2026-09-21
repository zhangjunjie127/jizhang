import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PRIORITIES, taskPriority } from '../shared/task-priorities.mjs';
import { validateRecord } from '../server/domain.mjs';
import { groupTasks } from '../src/tasks.js';

test('four priorities validate, retain legacy values and reject unknown priorities', () => {
  assert.equal(TASK_PRIORITIES.length, 4);
  for (const item of TASK_PRIORITIES) assert.equal(validateRecord('task', { title: 'test', priority: item.value }).priority, item.value);
  assert.equal(validateRecord('task', { title: 'test', priority: 'normal' }).priority, 'important');
  assert.equal(taskPriority('normal').value, 'important');
  assert.equal(taskPriority('high').label, '重要且紧急');
  assert.equal(taskPriority('low').label, '不重要不紧急');
  assert.equal(validateRecord('task', { title: 'test' }).priority, 'low');
  assert.throws(() => validateRecord('task', { title: 'test', priority: 'other' }));
});

test('priority ordering is stable within each date and does not move tasks across dates', () => {
  const records = ['low', 'urgent', 'normal', 'important', 'high'].map((priority, index) => ({
    id: String(index), kind: 'task', status: 'confirmed', completed: false,
    payload: { title: priority, priority, scheduledDate: '2026-09-19' },
  }));
  records.push({ id: 'earlier', kind: 'task', status: 'confirmed', payload: { title: 'earlier', priority: 'low', scheduledDate: '2026-09-18' } });
  const groups = groupTasks(records, false);
  assert.equal(groups[0].date, '2026-09-18');
  assert.deepEqual(groups[1].records.map(item => item.payload.priority), ['high', 'normal', 'important', 'urgent', 'low']);
});
