import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createHealthStore, foodDraft, healthEntry } from '../server/health.mjs';
import { healthSummary, healthReminders, FOODS, nutritionTotal } from '../shared/health.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,birthday TEXT,gender TEXT);
    INSERT INTO users VALUES('female','2000-01-01','female'),('male','2000-01-01','male'),('unknown','2000-01-01',''),('minor','2015-01-01','female');`);
  return { db, store: createHealthStore(db) };
}
const meal = () => ({ kind: 'meal', date: '2026-10-01', meal: 'lunch', items: [FOODS[2]], requestId: randomUUID() });
const period = () => ({ kind: 'period', date: '2026-09-01', end: '2026-09-05', flow: 'medium', symptoms: ['腹痛'], requestId: randomUUID() });
test('medical records validate fields, photo ownership, revisions and private follow-up reminders', () => {
  const { db, store } = fixture();
  try {
    const checkup = { kind: 'checkup', date: '2026-10-01', institution: '体检中心', items: '血常规', photos: [], requestId: randomUUID() };
    const entry = store.save('female', checkup).entries[0];
    assert.equal(store.save('female', checkup).entries.length, 1);
    assert.equal(store.state('male').entries.length, 0);
    assert.throws(() => store.save('female', { ...checkup, requestId: randomUUID(), photos: [randomUUID()] }), /不存在/);
    const photo = randomUUID();
    db.prepare('INSERT INTO task_photos VALUES (?,?,?,?,?)').run(photo, 'male', 'test', 'hash', new Date().toISOString());
    assert.throws(() => store.save('female', { ...checkup, requestId: randomUUID(), photos: [photo] }), /不存在/);
    store.save('female', { ...checkup, items: '血常规、心电图', revision: 0 }, entry.id);
    assert.equal(store.state('female').entries[0].items, '血常规、心电图');
    assert.throws(() => store.remove('female', entry.id, 0), /已更新/);
    store.remove('female', entry.id, 1);
    const visit = { kind: 'visit', date: '2026-10-01', institution: '医院', department: '内科', reason: '复查', advice: '遵医嘱', followUp: '2026-10-20T08:00:00+08:00', requestId: randomUUID() };
    const saved = store.save('female', visit).entries[0];
    const reminders = healthReminders([saved], Date.parse('2026-10-01'));
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].title, '你有一项复诊安排');
    assert.equal(healthReminders([saved], Date.parse('2026-10-21')).length, 0);
    assert.throws(() => healthEntry({ ...visit, followUp: 'bad' }, {}), /复诊/);
    assert.throws(() => healthEntry({ ...visit, followUp: '2026-09-29T08:00:00Z' }, {}), /复诊/);
    const updated = store.save('female', { ...visit, followUp: '', revision: 0 }, saved.id);
    assert.equal(healthReminders(updated.entries, 0).length, 0);
    assert.throws(() => healthEntry({ ...checkup, institution: '' }, {}));
    assert.throws(() => healthEntry({ ...visit, reason: '' }, {}));
  } finally { db.close(); }
});
test('bowel, overnight sleep and daily habits persist with validation and ownership', () => {
  const { db, store } = fixture();
  try {
    const sleep = { kind: 'sleep', date: '2026-10-01', start: '2026-09-30T23:00:00+08:00', end: '2026-10-01T07:00:00+08:00', quality: '较好', requestId: randomUUID() };
    const saved = store.save('female', sleep).entries[0];
    assert.equal(Date.parse(saved.end) - Date.parse(saved.start), 8 * 3600000);
    assert.throws(() => store.save('female', { ...sleep, requestId: randomUUID() }), /已存在/);
    assert.throws(() => healthEntry({ ...sleep, end: sleep.start }, {}), /无效/);
    assert.throws(() => healthEntry({ ...sleep, quality: 'bad' }, {}), /感受/);
    store.save('female', { kind: 'bowel', date: '2026-10-01', texture: '成形', requestId: randomUUID() });
    assert.throws(() => healthEntry({ kind: 'bowel', date: '2026-10-01', texture: 'bad' }, {}), /形态/);
    const habit = { kind: 'habit', date: '2026-10-01', name: '拉伸', requestId: randomUUID() };
    store.save('female', habit);
    assert.throws(() => store.save('female', { ...habit, requestId: randomUUID() }), /已经打卡/);
    assert.equal(store.state('male').entries.length, 0);
    assert.equal(store.state('female').entries.length, 3);
    store.save('female', { ...sleep, revision: 0, quality: '一般' }, saved.id);
    store.remove('female', saved.id, 1);
    assert.equal(store.state('female').entries.length, 2);
  } finally { db.close(); }
});
test('health nutrition totals and day isolation use per-portion nutrients', () => {
  assert.equal(nutritionTotal([FOODS[2], FOODS[3]]).kcal, 285);
  const summary = healthSummary([
    meal(), { kind: 'water', date: '2026-10-01', ml: 250 }, { kind: 'water', date: '2026-10-02', ml: 100 },
    { kind: 'exercise', date: '2026-10-01', minutes: 30, kcal: 80 },
  ], '2026-10-01');
  assert.equal(summary.kcal, 130);
  assert.equal(summary.water, 250);
  assert.equal(summary.minutes, 30);
});
test('health records are user-isolated, idempotent, revision-checked and cascade with account deletion', () => {
  const { db, store } = fixture();
  try {
    const input = meal();
    let result = store.save('female', input);
    const id = result.entries[0].id;
    assert.equal(store.save('female', input).entries.length, 1);
    assert.equal(store.state('male').entries.length, 0);
    assert.throws(() => store.save('male', { ...input, revision: 0 }, id), /不存在/);
    assert.throws(() => store.remove('male', id, 0), /不存在/);
    result = store.save('female', { ...input, meal: 'dinner', revision: 0 }, id);
    assert.equal(result.entries[0].revision, 1);
    assert.throws(() => store.remove('female', id, 0), /已更新/);
    assert.equal(store.remove('female', id, 1).entries.length, 0);
    store.save('female', meal());
    store.settings('female', { heightCm: 165, waterGoal: 1800 });
    db.prepare('DELETE FROM users WHERE id=?').run('female');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM health_entries').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM health_settings').get().n, 0);
  } finally { db.close(); }
});
test('period gate is enforced on the server, overlaps rejected, gender changes hide rather than delete records', () => {
  const { db, store } = fixture();
  try {
    assert.throws(() => store.save('male', period()), /女性/);
    assert.throws(() => store.save('unknown', period()), /女性/);
    const input = period();
    const entry = store.save('female', input).entries[0];
    assert.equal(store.save('female', input).entries.length, 1);
    assert.throws(() => store.save('female', { ...period(), date: '2026-09-04', end: '2026-09-08' }), /已存在/);
    assert.throws(() => store.save('female', { ...period(), end: '2026-08-30' }), /早于/);
    db.prepare('UPDATE users SET gender=? WHERE id=?').run('male', 'female');
    assert.equal(store.state('female').entries.length, 0);
    assert.throws(() => store.remove('female', entry.id, 0), /性别/);
    db.prepare('UPDATE users SET gender=? WHERE id=?').run('female', 'female');
    assert.equal(store.state('female').entries.length, 1);
    assert.equal(store.remove('female', entry.id, 0).entries.length, 0);
    store.save('female', { ...period(), end: null });
    assert.throws(() => store.save('female', { ...period(), date: '2026-10-01', end: null }), /已存在/);
  } finally { db.close(); }
});
test('invalid dates, future data, malformed foods and minor diet targets fail validation', () => {
  const { db, store } = fixture();
  try {
    for (const date of ['2026-02-30', '2099-01-01', 'bad']) assert.throws(() => store.save('female', { ...meal(), date }));
    for (const value of [-1, Infinity, null, '', true]) assert.throws(() => healthEntry({ kind: 'water', date: '2026-10-01', ml: value }, {}));
    assert.throws(() => store.save('female', { ...meal(), items: [] }));
    assert.throws(() => store.settings('minor', { calorieGoal: 1500 }), /未成年人/);
    assert.throws(() => store.settings('minor', { goalKg: 50 }), /未成年人/);
    assert.equal(store.settings('minor', { heightCm: 150 }).settings.heightCm, 150);
  } finally { db.close(); }
});
test('AI food recognition creates editable estimates, not persisted records, and rejects nonfood', () => {
  assert.throws(() => foodDraft('not json'), /格式异常/);
  assert.throws(() => foodDraft('{"isFood":false,"items":[]}'), /未识别/);
  const result = foodDraft(JSON.stringify({ isFood: true, items: [{ name: '米饭', grams: 150, kcal: 195, protein: null, fat: 'unknown', carbs: -1 }] }));
  assert.equal(result.items[0].kcal, 195);
  assert.equal(result.items[0].protein, '');
  assert.equal(result.items[0].fat, '');
  assert.equal(result.items[0].carbs, '');
  assert.equal(result.items[0].source, 'AI');
  assert.ok(result.warnings.length > 0);
  assert.equal(result.id, undefined);
});
