import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createPlannerStore, validatePlanner } from '../server/planner.mjs';
import { courseLessons } from '../shared/courses.mjs';
test('single weekday and multiple periods save atomically with education and independent lessons', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('a')");
  const store = createPlannerStore(db);
  const entries = [1, 2, 3].map(order => ({ kind: 'course', requestId: randomUUID(),
    payload: { title: '语文', tone: 'rose', weekdays: [0], order, stage: '小学', grade: '一年级', className: '一班' } }));
  try {
    const result = store.saveCourseBatch('a', { entries });
    assert.equal(result.items.length, 3);
    assert.deepEqual(courseLessons(result.items, [], '2026-09-21', '2026-09-21').map(item => item.order), [1, 2, 3]);
    assert.equal(store.saveCourseBatch('a', { entries }).items.length, 3);
    const bad = entries.map(entry => ({ ...entry, requestId: randomUUID(), payload: { ...entry.payload } }));
    bad[2].payload.grade = '大四';
    assert.throws(() => store.saveCourseBatch('a', { entries: bad }));
    assert.equal(store.state('a').items.length, 3);
    assert.throws(() => store.saveCourseBatch('a', { entries: [{ ...entries[0], payload: { ...entries[0].payload, weekdays: [0, 1] } }] }));
    const edit = { ...entries[0], id: entries[0].requestId, revision: 0, payload: { ...entries[0].payload, title: '数学' } };
    assert.equal(store.saveCourseBatch('a', { entries: [edit] }).items.find(item => item.id === edit.id).payload.title, '数学');
    assert.throws(() => store.saveCourseBatch('a', { entries: [edit] }));
    assert.equal(validatePlanner('course', entries[0].payload).grade, '一年级');
  } finally { db.close(); }
});
