import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createPlannerStore, validatePlanner } from '../server/planner.mjs';
import { monthDays, weekday, shiftDate, plannerToday, checkedDates, habitStreak, habitScheduled, habitDue, habitProgress, habitRepeatLabel, habitReminders } from '../shared/planner.mjs';
import { validateRecord } from '../server/domain.mjs';
import { groupTasks, filterTasks } from '../src/tasks.js';

const habit = { title: '阅读', weekdays: [0, 1, 2, 3, 4, 5, 6], tone: 'green', icon: 'book', note: '' };
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('u1'),('u2');");
  return { db, store: createPlannerStore(db) };
}
test('planner validates weekdays, title, palettes and course order without requiring times', () => {
  assert.throws(() => validatePlanner('habit', { ...habit, weekdays: [] }));
  assert.throws(() => validatePlanner('habit', { ...habit, weekdays: [0, 0] }));
  assert.throws(() => validatePlanner('habit', { ...habit, weekdays: [7] }));
  assert.throws(() => validatePlanner('habit', { ...habit, icon: 'unknown' }));
  assert.throws(() => validatePlanner('course', { ...habit, order: 0 }));
  assert.equal(validatePlanner('course', { ...habit, order: 2 }).order, 2);
  assert.equal(validatePlanner('course', { ...habit, order: 2 }).time, undefined);
});
test('planner stores are user scoped, idempotent, revision checked and cascade with account deletion', () => {
  const { db, store } = fixture();
  try {
    const requestId = randomUUID(), body = { requestId, kind: 'habit', payload: habit };
    store.save('u1', body); store.save('u1', body);
    assert.equal(store.state('u1').items.length, 1);
    assert.equal(store.state('u2').items.length, 0);
    assert.throws(() => store.save('u2', body));
    assert.throws(() => store.check('u2', requestId, { checked: true, date: plannerToday() }));
    assert.throws(() => store.remove('u2', requestId, { revision: 0 }));
    store.save('u1', { payload: { ...habit, title: '每日阅读' }, revision: 0 }, requestId);
    assert.throws(() => store.save('u1', { payload: habit, revision: 0 }, requestId));
    store.check('u1', requestId, { date: plannerToday(), checked: true });
    db.prepare('DELETE FROM users WHERE id=?').run('u1');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planner_checks').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planner_items').get().n, 0);
  } finally { db.close(); }
});
test('habit checks use real valid dates, repeat days, no future dates, are idempotent and can be undone', () => {
  const { db, store } = fixture();
  try {
    const requestId = randomUUID();
    store.save('u1', { requestId, kind: 'habit', payload: { ...habit, weekdays: [0, 2, 4] } });
    db.prepare('UPDATE planner_items SET created=? WHERE id=?').run('2026-09-01T00:00:00Z', requestId);
    const set = (date, checked = true) => store.check('u1', requestId, { date, checked }, '2026-09-19');
    set('2026-09-18'); set('2026-09-18');
    assert.equal(store.state('u1').checks.length, 1);
    assert.throws(() => set('2026-09-19'));
    assert.throws(() => set('2026-09-21'));
    assert.throws(() => set('2026-08-31'));
    assert.throws(() => set('2026-02-30'));
    assert.throws(() => set('2026-09-18', 'true'));
    set('2026-09-18', false);
    assert.equal(store.state('u1').checks.length, 0);
    set('2026-09-18');
    store.remove('u1', requestId, { revision: 0 });
    assert.equal(store.state('u1').items.length, 0);
    assert.equal(store.state('u1').checks.length, 0);
    assert.throws(() => set('2026-09-18'));
  } finally { db.close(); }
});
test('calendar covers leap years, Monday start, midnight timezone and repeat-aware streaks', () => {
  assert.equal(monthDays('2024-02').length, 42);
  assert(monthDays('2024-02').includes('2024-02-29'));
  assert.equal(weekday(monthDays('2024-02')[0]), 0);
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(plannerToday('2026-09-18T16:00:00Z'), '2026-09-19');
  const item = { id: 'h', created: '2026-09-01', payload: { weekdays: [0, 2, 4] } };
  const dates = checkedDates([{ item_id: 'h', date: '2026-09-18' }, { item_id: 'h', date: '2026-09-16' }, { item_id: 'other', date: '2026-09-14' }], 'h');
  assert.equal(habitStreak(item, dates, '2026-09-19'), 2);
});
test('scheduled dates do not create reminders and old due tasks keep working', () => {
  const payload = validateRecord('task', { title: '安排读书', scheduledDate: '2026-09-19', priority: 'high', note: '第一章' });
  assert.equal(payload.due, null);
  const records = [{ id: 't', kind: 'task', status: 'confirmed', payload }];
  assert.equal(groupTasks(records, false)[0].date, '2026-09-19');
  assert.equal(filterTasks(records, 'today', '', new Date('2026-09-19T08:00:00Z')).length, 1);
  assert.throws(() => validateRecord('task', { title: 'x', scheduledDate: '2026-02-30' }));
  assert.throws(() => validateRecord('task', { title: 'x', priority: 'bad' }));
});

test('habit goal fields validate dates, recurrence, focus and independent reminder times', () => {
  const payload = validatePlanner('habit', { ...habit, repeat: 'monthly', monthDays: [31, 15],
    startDate: '2026-09-01', endDate: '2026-12-31', focus: true, focusMinutes: 45,
    skipHolidays: true, reminders: ['22:00', '07:30'], icon: 'moon' });
  assert.deepEqual(payload.monthDays, [15, 31]);
  assert.deepEqual(payload.reminders, ['07:30', '22:00']);
  for (const patch of [{ repeat: 'bad' }, { monthDays: [] }, { monthDays: [32] }, { monthDays: [1, 1] },
    { repeat: 'week-flex', targetCount: 8 }, { targetCount: 1.5 }, { startDate: '2026-02-30' },
    { startDate: '2026-10-01', endDate: '2026-09-01' }, { focusMinutes: 0 }, { focusMinutes: 181 },
    { focus: 'true' }, { skipHolidays: 'false' }, { reminders: ['24:00'] }, { reminders: ['09:00', '09:00'] }]) {
    assert.throws(() => validatePlanner('habit', { ...habit, ...patch }), JSON.stringify(patch));
  }
});

test('monthly goals skip nonexistent dates, respect boundaries and published holiday exclusions', () => {
  const item = { created: '2026-01-01', payload: { ...habit, repeat: 'monthly', monthDays: [15, 31],
    startDate: '2026-02-01', endDate: '2026-03-31' } };
  assert.equal(habitScheduled(item, '2026-01-31'), false);
  assert.equal(habitScheduled(item, '2026-02-15'), true);
  assert.equal(habitScheduled(item, '2026-02-28'), false);
  assert.equal(habitScheduled(item, '2026-03-31'), true);
  assert.equal(habitScheduled(item, '2026-04-15'), false);
  item.payload = { ...habit, skipHolidays: true };
  assert.equal(habitScheduled(item, '2026-10-01'), false);
  assert.equal(habitScheduled(item, '2026-09-20'), true);
});

test('flexible periods track distinct dates across month and year boundaries without randomly assigning days', () => {
  const item = { id: 'h', created: '2026-01-01', payload: { ...habit, repeat: 'week-flex', targetCount: 2 } };
  const dates = new Set(['2026-09-14', '2026-09-18']);
  assert.equal(habitProgress(item, dates, '2026-09-20'), 2);
  assert.equal(habitDue(item, dates, '2026-09-20'), false);
  assert.equal(habitDue(item, dates, '2026-09-21'), true);
  assert.equal(habitStreak(item, dates, '2026-09-20'), 1);
  assert.equal(habitRepeatLabel(item.payload), '每周 2 次');
  item.payload.repeat = 'month-flex';
  assert.equal(habitProgress(item, new Set(['2026-12-31', '2027-01-01']), '2027-01-02'), 1);
});

test('habit reminders are chronological, Shanghai-based and omit completed, ended and holiday occurrences', () => {
  const item = { id: 'h', kind: 'habit', created: '2026-09-01', payload: { ...habit,
    reminders: ['22:00', '09:00'], startDate: '2026-09-01', endDate: '2026-09-22' } };
  const now = Date.parse('2026-09-20T00:00:00Z');
  const reminders = habitReminders([item], [{ item_id: 'h', date: '2026-09-20' }], now, 30);
  assert.equal(reminders.length, 4);
  assert.equal(reminders[0].at, Date.parse('2026-09-21T01:00:00Z'));
  assert.equal(new Set(reminders.map(item => item.key)).size, 4);
  item.payload.skipHolidays = true; item.payload.endDate = '2026-10-07';
  assert.equal(habitReminders([item], [], Date.parse('2026-10-01T00:00:00+08:00'), 1).length, 0);
});

test('extended habit settings persist through edits and historical checks survive schedule changes', () => {
  const { db, store } = fixture();
  try {
    const id = randomUUID();
    const payload = { ...habit, startDate: '2026-09-01', endDate: '2026-12-31',
      repeat: 'week-flex', targetCount: 3, focus: true, focusMinutes: 15, reminders: ['10:00', '18:00'] };
    store.save('u1', { requestId: id, kind: 'habit', payload });
    store.check('u1', id, { date: '2026-09-18', checked: true }, '2026-09-20');
    store.save('u1', { revision: 0, payload: { ...payload, startDate: '2026-09-20', repeat: 'monthly', monthDays: [1] } }, id);
    store.check('u1', id, { date: '2026-09-18', checked: true }, '2026-09-20');
    assert.equal(store.state('u1').checks.length, 1);
    assert.equal(store.state('u1').items[0].payload.focusMinutes, 15);
    assert.equal(store.state('u2').checks.length, 0);
    store.check('u1', id, { date: '2026-09-18', checked: false }, '2026-09-20');
    assert.equal(store.state('u1').checks.length, 0);
  } finally { db.close(); }
});
