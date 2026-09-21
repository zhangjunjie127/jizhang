import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountDeletionStore } from '../server/account-deletion.mjs';
import { passwordHash, tokenHash } from '../server/domain.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,password TEXT);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires TEXT);
    CREATE TABLE records(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE debt_people(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,UNIQUE(id,user_id));
    CREATE TABLE debt_bills(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,person_id TEXT,UNIQUE(id,user_id),FOREIGN KEY(person_id,user_id) REFERENCES debt_people(id,user_id));
    CREATE TABLE debt_payments(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,bill_id TEXT,ledger_record_id TEXT REFERENCES records(id),FOREIGN KEY(bill_id,user_id) REFERENCES debt_bills(id,user_id));
    CREATE TABLE assistant_actions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));`);
  for (const table of ['checkins', 'messages', 'memories', 'usage', 'feedback']) db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE)`);
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO users VALUES (?,?,?)').run(id, id, passwordHash('password-123456'));
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(`${id}-token`), id, new Date(Date.now() + 86400000).toISOString());
    for (const table of ['records', 'assistant_actions', 'checkins', 'messages', 'memories', 'usage', 'feedback']) db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run(id, id);
    db.prepare('INSERT INTO debt_people VALUES (?,?)').run(id, id);
    db.prepare('INSERT INTO debt_bills VALUES (?,?,?)').run(id, id, id);
    db.prepare('INSERT INTO debt_payments VALUES (?,?,?,?)').run(id, id, id, id);
  }
  t.after(() => db.close());
  return { db, store: createAccountDeletionStore(db) };
}
const body = { currentPassword: 'password-123456', acknowledged: true, confirmation: '申请注销' };
test('deletion requires valid session, password and explicit confirmation; submission only creates one pending application', t => {
  const { db, store } = setup(t);
  for (const invalid of [{ ...body, currentPassword: 'wrong' }, { ...body, acknowledged: false }, { ...body, confirmation: '' }]) assert.throws(() => store.submit('a', 'a-token', invalid));
  assert.throws(() => store.submit('a', 'b-token', body), /登录/);
  assert.equal(store.latest('a'), null);
  const application = store.submit('a', 'a-token', body);
  assert.equal(application.status, 'pending');
  assert.deepEqual(store.submit('a', 'a-token', body), application);
  assert.equal(store.pending().length, 1);
  assert.equal(store.latest('b'), null);
  assert.ok(db.prepare("SELECT id FROM users WHERE id='a'").get());
  assert.ok(db.prepare("SELECT id FROM records WHERE id='a'").get());
});
test('requests may be withdrawn only by owner; withdrawn/rejected requests cannot be approved', t => {
  const { store } = setup(t);
  const first = store.submit('a', 'a-token', body);
  assert.throws(() => store.cancel('b', first.id), /不存在/);
  assert.throws(() => store.review(first.id, 'b', 'approve'), /不匹配/);
  assert.equal(store.cancel('a', first.id).status, 'cancelled');
  assert.throws(() => store.review(first.id, 'a', 'approve'), /不匹配/);
  const second = store.submit('a', 'a-token', body);
  assert.notEqual(second.id, first.id);
  assert.throws(() => store.review(second.id, 'a', 'reject'), /原因/);
  store.review(second.id, 'a', 'reject', '用户需先核对数据');
  assert.equal(store.latest('a').status, 'rejected');
  assert.equal(store.latest('a').reason, '用户需先核对数据');
  assert.throws(() => store.review(second.id, 'a', 'approve'), /不匹配/);
});
test('administrator approval atomically removes account and linked debts, records and sessions without affecting another account', t => {
  const { db, store } = setup(t);
  const application = store.submit('a', 'a-token', body);
  store.review(application.id, 'a', 'approve');
  assert.equal(db.prepare("SELECT id FROM users WHERE id='a'").get(), undefined);
  assert.ok(db.prepare("SELECT id FROM users WHERE id='b'").get());
  for (const table of ['sessions', 'records', 'debt_people', 'debt_bills', 'debt_payments', 'assistant_actions', 'checkins', 'messages', 'memories', 'usage', 'feedback', 'account_deletion_requests']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id='a'`).get().n, 0, table);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM debt_payments WHERE user_id='b'").get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('approval failure rolls back all deletions and preserves the pending request', t => {
  const { db, store } = setup(t);
  const application = store.submit('a', 'a-token', body);
  db.exec("CREATE TRIGGER prevent_record_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.throws(() => store.review(application.id, 'a', 'approve'), /fixture failure/);
  assert.equal(store.latest('a').status, 'pending');
  assert.ok(db.prepare("SELECT id FROM debt_payments WHERE id='a'").get());
  assert.ok(db.prepare("SELECT id FROM assistant_actions WHERE id='a'").get());
});
test('administrator CLI requires explicit safeguards and reviews only the matched test account', t => {
  const directory = mkdtempSync(join(tmpdir(), 'account-deletion-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT); INSERT INTO users VALUES (\'a\',\'fixture\'),(\'b\',\'preserved\')');
  createAccountDeletionStore(db);
  db.exec("INSERT INTO account_deletion_requests(id,user_id,status,created) VALUES ('request','a','pending','2026-09-18T00:00:00Z')");
  db.close();
  const run = (...args) => spawnSync(process.execPath, ['scripts/review-account-deletion.mjs', '--database', path, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(run('--list').stdout)[0].id, 'request');
  assert.notEqual(run('--approve', 'request', '--confirm-user', 'a').status, 0);
  assert.notEqual(run('--approve', 'request', '--confirm-user', 'b', '--server-stopped').status, 0);
  assert.notEqual(run('--reject', 'request', '--confirm-user', 'a', '--server-stopped').status, 0);
  assert.equal(run('--reject', 'request', '--confirm-user', 'a', '--server-stopped', '--reason', 'test rejection').status, 0);
  const check = new DatabaseSync(path);
  try {
    assert.equal(check.prepare("SELECT status FROM account_deletion_requests WHERE id='request'").get().status, 'rejected');
    check.exec("INSERT INTO account_deletion_requests(id,user_id,status,created) VALUES ('second','a','pending','2026-09-18T00:00:01Z')");
  } finally { check.close(); }
  assert.equal(run('--approve', 'second', '--confirm-user', 'a', '--server-stopped').status, 0);
  const final = new DatabaseSync(path);
  try { assert.deepEqual(final.prepare('SELECT id FROM users').all().map(row => row.id), ['b']); }
  finally { final.close(); }
});
