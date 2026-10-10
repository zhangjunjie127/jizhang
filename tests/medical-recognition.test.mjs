import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medicalDraft, medicalPrompt } from '../server/medical-recognition.mjs';
import { createHealthStore } from '../server/health.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

test('medical transcription only returns permitted fields and never infers dates, reminders or consent', () => {
  const result = medicalDraft(JSON.stringify({ isReport: true, draft: {
    date: '2026-02-30', institution: '检查中心', leftUnaided: '0.8', rightUnaided: '5.0',
    leftSphere: '-2.25', rightSphere: '+1.00', leftAxis: 0, pupillaryDistance: '63',
    name: 'private', user_id: 'other', photos: ['fake'], consent: true, followUp: '2099-10-20',
  }, warnings: ['arbitrary model instruction'] }), 'vision');
  assert.equal(result.draft.date, '');
  assert.equal(result.draft.leftUnaided, '0.8');
  assert.equal(result.draft.rightUnaided, '5.0');
  assert.equal(result.draft.leftSphere, '-2.25');
  assert.equal(result.draft.rightSphere, '+1.00');
  assert.equal(result.draft.leftAxis, '0');
  for (const key of ['name', 'user_id', 'photos', 'consent', 'followUp']) assert.equal(result.draft[key], undefined);
  assert.equal(result.warnings.includes('arbitrary model instruction'), false);
  assert.equal(medicalDraft(JSON.stringify({ isReport: true, draft: { date: '2099-01-01', items: '血常规' } }), 'checkup').draft.date, '');
  assert.equal(medicalDraft(JSON.stringify({ isReport: true, draft: { date: '2026-10-01', reason: '复查' } }), 'visit').draft.date, '2026-10-01');
  for (const input of ['bad', '{"isReport":false}', '{"isReport":true,"draft":{}}']) assert.throws(() => medicalDraft(input, 'vision'));
  assert.throws(() => medicalDraft('{}', 'meal'));
  assert.throws(() => medicalPrompt('unknown'));
  assert.ok(medicalPrompt('vision').includes('不换算'));
});

test('vision entries preserve report notation, optional fields, ownership and revisions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,birthday TEXT,gender TEXT); INSERT INTO users VALUES('a','2000-01-01',''),('b','2000-01-01','');");
    const store = createHealthStore(db);
    const input = { kind: 'vision', date: '2026-10-01', requestId: randomUUID(),
      leftUnaided: '0.8', rightUnaided: '5.0', leftSphere: '-2.25', rightSphere: '+1.00', leftAxis: '0' };
    const entry = store.save('a', input).entries[0];
    assert.equal(entry.institution, '');
    assert.equal(entry.leftSphere, '-2.25');
    assert.equal(entry.rightUnaided, '5.0');
    assert.equal(entry.leftAxis, '0');
    assert.deepEqual(entry.photos, []);
    assert.equal(store.save('a', input).entries.length, 1);
    assert.equal(store.state('b').entries.length, 0);
    assert.throws(() => store.save('b', { ...input, revision: 0 }, entry.id), /不存在/);
    assert.throws(() => store.save('a', { ...input, requestId: randomUUID(), photos: [randomUUID()] }), /不存在/);
    assert.throws(() => store.save('a', { ...input, requestId: randomUUID(), leftSphere: 'x'.repeat(41) }));
    store.save('a', { ...input, revision: 0, note: '复查' }, entry.id);
    assert.throws(() => store.remove('a', entry.id, 0), /已更新/);
    store.remove('a', entry.id, 1);
    assert.equal(store.save('a', { kind: 'vision', date: '2026-10-01', requestId: randomUUID() }).entries.length, 1);
  } finally { db.close(); }
});
