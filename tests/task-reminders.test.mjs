import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord } from '../server/domain.mjs';
import { taskReminderOccurrences } from '../shared/task-reminders.mjs';

const record = (repeat, due = '2026-01-31T01:00:00.000Z') => ({
  kind: 'task', status: 'confirmed', completed: false,
  payload: { title: '采购核对', due, reminderRepeat: repeat },
});
const occurrences = (item, from, to) => taskReminderOccurrences(item, Date.parse(from), Date.parse(to)).map(at => new Date(at).toISOString());

test('trace date is independent of record date, planned date, and reminder time', () => {
  const result = validateRecord('task', { title: '采购核对', date: '2026-09-20', occurredDate: '2026-09-01',
    scheduledDate: '2026-09-22', due: '2026-09-23T09:00:00+08:00', reminderRepeat: 'weekly', created: '2000-01-01' });
  assert.equal(result.occurredDate, '2026-09-01');
  assert.equal(result.date, '2026-09-20');
  assert.equal(result.scheduledDate, '2026-09-22');
  assert.equal(result.due, '2026-09-23T01:00:00.000Z');
  assert.equal(result.created, undefined);
  assert.throws(() => validateRecord('task', { title: 'a', occurredDate: '2026-02-30' }));
  assert.throws(() => validateRecord('task', { title: 'a', reminderRepeat: 'weekly' }));
  assert.throws(() => validateRecord('task', { title: 'a', reminderRepeat: 'daily' }));
});
test('monthly reminders skip missing dates and preserve Shanghai clock', () => {
  assert.deepEqual(occurrences(record('monthly'), '2026-01-01', '2026-04-01'),
    ['2026-01-31T01:00:00.000Z', '2026-03-31T01:00:00.000Z']);
});
test('weekly reminders cross year boundaries without moving the original record', () => {
  const item = record('weekly', '2026-12-27T16:30:00.000Z');
  assert.deepEqual(occurrences(item, '2026-12-28T00:00:00Z', '2027-01-12'),
    ['2027-01-03T16:30:00.000Z', '2027-01-10T16:30:00.000Z']);
  assert.equal(item.payload.due, '2026-12-27T16:30:00.000Z');
});
test('completed, deleted and pending tasks do not remind; legacy tasks remain single reminders', () => {
  for (const patch of [{ completed: true }, { deleted_at: '2026-01-01' }, { status: 'pending' }]) {
    assert.deepEqual(occurrences({ ...record('monthly'), ...patch }, '2026-01-01', '2027-01-01'), []);
  }
  assert.deepEqual(occurrences(record(undefined), '2026-01-01', '2027-01-01'), ['2026-01-31T01:00:00.000Z']);
});

test('two weekdays share the same reminder clock', () => {
  const item = record('weekly', '2026-09-20T01:00:00.000Z');
  item.payload.reminderDays = [2, 5];
  assert.deepEqual(occurrences(item, '2026-09-20', '2026-10-01'), [
    '2026-09-22T01:00:00.000Z', '2026-09-25T01:00:00.000Z', '2026-09-29T01:00:00.000Z',
  ]);
});
test('multiple month days share a clock and missing dates are skipped', () => {
  const item = record('monthly', '2026-01-01T01:00:00.000Z');
  item.payload.reminderDays = [1, 5, 20, 31];
  assert.deepEqual(occurrences(item, '2026-02-01', '2026-03-01'), [
    '2026-02-01T01:00:00.000Z', '2026-02-05T01:00:00.000Z', '2026-02-20T01:00:00.000Z',
  ]);
});
test('repeat days are validated, sorted and ignored for single reminders', () => {
  const base = { title: '采购核对', due: '2026-09-20T01:00:00Z', reminderRepeat: 'weekly' };
  assert.deepEqual(validateRecord('task', { ...base, reminderDays: [5, 2] }).reminderDays, [2, 5]);
  assert.deepEqual(validateRecord('task', base).reminderDays, [0]);
  for (const reminderDays of [[], [7], [-1], [2, 2], ['2'], [1.5], '2,5']) {
    assert.throws(() => validateRecord('task', { ...base, reminderDays }));
  }
  assert.throws(() => validateRecord('task', { ...base, reminderRepeat: 'monthly', reminderDays: [0] }));
  assert.throws(() => validateRecord('task', { ...base, reminderRepeat: 'monthly', reminderDays: [32] }));
  assert.equal(validateRecord('task', { ...base, reminderRepeat: 'once', reminderDays: [2, 5] }).reminderDays, undefined);
});
