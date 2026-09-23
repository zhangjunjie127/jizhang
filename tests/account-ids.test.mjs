import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountId, migrateAccountIds, NUMERIC_ACCOUNT_ID } from '../server/account-ids.mjs';

test('account ID migration keeps all user-linked data and produces stable 10-digit IDs', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE records(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE planner_items(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    INSERT INTO users VALUES ('legacy-user', 'legacy'), ('1234567890', 'numeric');
    INSERT INTO sessions VALUES ('session-1', 'legacy-user');
    INSERT INTO records VALUES ('record-1', 'legacy-user');
    INSERT INTO planner_items VALUES ('planner-1', 'legacy-user');`);

  const result = migrateAccountIds(db);
  const legacy = db.prepare("SELECT id FROM users WHERE username='legacy'").get().id;
  assert.equal(result.changed, 1);
  assert.match(legacy, NUMERIC_ACCOUNT_ID);
  assert.notEqual(legacy, '1234567890');
  assert.equal(db.prepare('SELECT user_id FROM sessions WHERE hash=?').get('session-1').user_id, legacy);
  assert.equal(db.prepare('SELECT user_id FROM records WHERE id=?').get('record-1').user_id, legacy);
  assert.equal(db.prepare('SELECT user_id FROM planner_items WHERE id=?').get('planner-1').user_id, legacy);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(migrateAccountIds(db).changed, 0);
  assert.match(createAccountId(db), NUMERIC_ACCOUNT_ID);
});
