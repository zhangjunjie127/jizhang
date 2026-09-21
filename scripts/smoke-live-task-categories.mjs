import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { tokenHash, passwordHash } from '../server/domain.mjs';
import { TASK_CATEGORIES } from '../shared/task-categories.mjs';
import { TASK_PRIORITIES } from '../shared/task-priorities.mjs';
import { plannerToday } from '../shared/planner.mjs';

const origin = process.argv[2];
const database = process.argv[3];
assert(origin && database, 'Supply the local API origin and its database path');
const db = new DatabaseSync(database);
db.exec('PRAGMA foreign_keys=ON');
const id = randomUUID();
const token = randomBytes(32).toString('hex');
try {
  db.prepare('INSERT INTO users (id,username,password,name,birthday,proactive,created) VALUES (?,?,?,?,?,0,?)')
    .run(id, `category-test-${id}`, passwordHash(randomBytes(32).toString('hex')), '分类测试', '2000-01-01', new Date().toISOString());
  db.prepare('INSERT INTO sessions (hash,user_id,expires) VALUES (?,?,?)')
    .run(tokenHash(token), id, new Date(Date.now() + 60000).toISOString());
  for (const [index, { label }] of TASK_CATEGORIES.entries()) {
    const priority = TASK_PRIORITIES[index % TASK_PRIORITIES.length].value;
    const response = await fetch(`${origin}/api/records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'task', confirmed: true, payload: { title: `分类测试-${label}`, category: label, priority } }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.records.find(record => record.id === result.proposed.id).payload.category, label);
    assert.equal(result.records.find(record => record.id === result.proposed.id).payload.priority, priority);
  }
  const response = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(state.records.map(record => record.payload.category).sort(), TASK_CATEGORIES.map(category => category.label).sort());
  assert.equal(new Set(state.records.map(record => record.payload.priority)).size, 4);
  console.log('PASS: all six task categories persist through the running API and a fresh state read.');
  async function plannerCall(path, body) {
    const response = await fetch(`${origin}/api${path}`, { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert(response.ok, `Planner route failed: ${path}`);
    return response.json();
  }
  const habitId = randomUUID();
  await plannerCall('/planner', { kind: 'habit', requestId: habitId, payload: { title: '部署验证习惯', weekdays: [0, 1, 2, 3, 4, 5, 6], tone: 'green', icon: 'book' } });
  await plannerCall(`/planner/${habitId}/check`, { date: plannerToday(), checked: true });
  await plannerCall('/planner', { kind: 'course', requestId: randomUUID(), payload: { title: '部署验证课程', weekdays: [0], order: 1, tone: 'blue' } });
  const plannerState = await plannerCall('/planner');
  assert.equal(plannerState.items.length, 2);
  assert.equal(plannerState.checks.length, 1);
  console.log('PASS: live habit creation/check-in and weekday course persistence.');
  const anniversaryId = randomUUID();
  await plannerCall('/planner', { kind: 'anniversary', requestId: anniversaryId,
    payload: { title: '部署验证纪念日', date: plannerToday(), calendar: 'lunar', repeat: 'yearly', tone: 'rose' } });
  const anniversary = (await plannerCall('/planner')).items.find(item => item.id === anniversaryId);
  assert.equal(anniversary.payload.calendar, 'lunar');
  await plannerCall(`/planner/${anniversaryId}/remove`, { revision: anniversary.revision });
  assert.equal((await plannerCall('/planner')).items.some(item => item.id === anniversaryId), false);
  console.log('PASS: live anniversary creation, persistence and deletion.');
} finally {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM records WHERE user_id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
  console.log('Temporary test account and its records removed; existing accounts untouched.');
}
