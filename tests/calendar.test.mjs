import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { calendarInfo, anniversaryOccurs, validCalendarDate, calendarAlmanac, calendarClock, calendarCorner, calendarDayEntries } from '../shared/calendar.mjs';
import { createPlannerStore, validatePlanner } from '../server/planner.mjs';
import { TASK_PRIORITIES } from '../shared/task-priorities.mjs';

const payload = { title: '结婚纪念日', date: '2020-09-19', calendar: 'solar', repeat: 'yearly', tone: 'rose', note: '' };
test('calendar sorts Shanghai 24-hour times before untimed entries, independently of priority', () => {
  const tasks = [
    { id: 'late', payload: { due: '2026-09-19T13:00:00+08:00', priority: 'high' } },
    { id: 'untimed', payload: { due: null } },
    { id: 'early', payload: { due: '2026-09-19T01:00:00Z', priority: 'low' } },
    { id: 'midnight', payload: { due: '2026-09-18T16:00:00Z' } },
    { id: 'invalid', payload: { due: 'invalid' } },
  ];
  const anniversary = { id: 'anniversary', payload };
  const entries = calendarDayEntries(tasks, [anniversary]);
  assert.deepEqual(entries.map(entry => entry.item.id), ['midnight', 'early', 'late', 'untimed', 'invalid', 'anniversary']);
  assert.deepEqual(entries.map(entry => entry.time), ['00:00', '09:00', '13:00', '', '', '']);
  assert.equal(entries.length, 6);
  assert.equal(tasks[0].id, 'late');
  assert.equal(calendarDayEntries([]).length, 0);
});
test('calendar corner uses highest priority across all entries and separate anniversary/empty colors', () => {
  const tasks = values => values.map(priority => ({ payload: { priority } }));
  assert.equal(calendarCorner(tasks(['low', 'urgent', 'important', 'high'])).kind, 'high');
  assert.equal(calendarCorner(tasks(['low', 'urgent', 'normal'])).kind, 'important');
  assert.equal(calendarCorner(tasks(['low', 'urgent']), true).kind, 'urgent');
  assert.equal(calendarCorner(tasks([undefined])).kind, 'low');
  assert.equal(calendarCorner([], true).kind, 'anniversary');
  assert.equal(calendarCorner([]).kind, 'empty');
  const colors = ['high', 'important', 'urgent', 'low'].map(value => calendarCorner(tasks([value])).color);
  colors.push(calendarCorner([], true).color, calendarCorner([]).color);
  assert.equal(new Set(colors).size, 6);
  assert.deepEqual(colors.slice(0, 4), TASK_PRIORITIES.map(priority => priority.color));
  assert.deepEqual(colors.slice(4), ['#bda35d', '#e9edf1']);
  const entries = tasks(['low', 'low', 'low', 'low', 'low', 'low', 'high']);
  assert.equal(calendarCorner(entries).kind, 'high');
  assert.equal(entries.at(0).payload.priority, 'low');
});
test('day preview matches reference date and calculates time in Shanghai independently of host timezone', () => {
  const detail = calendarAlmanac('2026-09-19', '17:45');
  assert.deepEqual([detail.lunarDate, detail.constellation, detail.zodiac, detail.year, detail.month, detail.day, detail.time, detail.week, detail.weekday],
    ['八月初九', '处女座', '马', '丙午', '丁酉', '丙申', '丁酉', 38, '星期六']);
  assert(detail.yi.includes('嫁娶'));
  assert(detail.ji.includes('入宅'));
  assert.notEqual(calendarAlmanac('2026-09-19', '09:00').time, detail.time);
  assert.equal(calendarClock(new Date('2026-09-18T16:00:00Z')), '00:00');
  assert.doesNotThrow(() => calendarAlmanac('1900-12-31', '00:00'));
  assert.doesNotThrow(() => calendarAlmanac('2101-01-01', '00:00'));
  assert.throws(() => calendarAlmanac('2026-02-30', '17:45'));
  assert.throws(() => calendarAlmanac('2026-09-19', '24:00'));
});
test('calendar exposes lunar days, festivals, terms and only published workday overrides', () => {
  assert.equal(calendarInfo('2026-09-19').lunarLabel, '初九');
  assert(calendarInfo('2026-09-25').festivals.includes('中秋节'));
  assert(calendarInfo('2026-09-10').festivals.includes('教师节'));
  assert.equal(calendarInfo('2026-09-23').term, '秋分');
  assert.equal(calendarInfo('2026-09-20').holiday.work, true);
  assert.equal(calendarInfo('2026-09-25').holiday.work, false);
  assert.equal(calendarInfo('2099-09-25').holiday, null);
  assert.equal(validCalendarDate('2026-02-30'), false);
  assert.equal(validCalendarDate('2024-02-29'), true);
});
test('anniversaries repeat by solar or lunar date, without inventing leap dates', () => {
  assert(anniversaryOccurs(payload, '2026-09-19'));
  assert(!anniversaryOccurs(payload, '2019-09-19'));
  assert(!anniversaryOccurs({ ...payload, repeat: 'once' }, '2026-09-19'));
  assert(anniversaryOccurs({ ...payload, repeat: 'once' }, '2020-09-19'));
  assert(!anniversaryOccurs({ ...payload, date: '2024-02-29' }, '2025-02-28'));
  const lunar = { ...payload, date: '2025-10-06', calendar: 'lunar' };
  assert(anniversaryOccurs(lunar, '2026-09-25'));
  assert(!anniversaryOccurs(lunar, '2026-10-06'));
  assert(calendarInfo('2023-03-22').lunarMonth < 0);
  assert(!anniversaryOccurs({ ...payload, date: '2023-03-22', calendar: 'lunar' }, '2024-03-10'));
});
test('anniversaries preserve old planner data and enforce account isolation, validation and revisions', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('a'),('b')");
  try {
    let store = createPlannerStore(db);
    store.save('a', { requestId: randomUUID(), kind: 'habit', payload: { title: '阅读', weekdays: [0], icon: 'book', tone: 'blue' } });
    store = createPlannerStore(db);
    const id = randomUUID(), body = { requestId: id, kind: 'anniversary', payload };
    store.save('a', body); store.save('a', body);
    assert.equal(store.state('a').items.length, 2);
    assert.equal(store.state('b').items.length, 0);
    assert.throws(() => store.save('b', body));
    assert.throws(() => store.remove('b', id, { revision: 0 }));
    assert.throws(() => store.check('a', id, { date: '2026-09-19', checked: true }));
    assert.throws(() => validatePlanner('anniversary', { ...payload, date: '2026-02-30' }));
    assert.throws(() => validatePlanner('anniversary', { ...payload, repeat: 'daily' }));
    store.save('a', { payload: { ...payload, title: '生日' }, revision: 0 }, id);
    assert.throws(() => store.save('a', { payload, revision: 0 }, id));
    store.remove('a', id, { revision: 1 });
    assert.equal(store.state('a').items.length, 1);
    db.prepare('DELETE FROM users WHERE id=?').run('a');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM planner_anniversaries').get().n, 0);
  } finally { db.close(); }
});
