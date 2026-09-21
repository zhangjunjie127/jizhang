import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountServices } from '../server/account-services.mjs';
import { passwordHash, tokenHash, verifyPassword } from '../server/domain.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,password TEXT,name TEXT DEFAULT 'Original');
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires TEXT);`);
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO users(id,password) VALUES (?,?)').run(id, passwordHash('old-password-123'));
    for (const suffix of ['1', '2']) db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(id + suffix), id, new Date(Date.now() + 86400000).toISOString());
  }
  t.after(() => db.close());
  return { db, service: createAccountServices(db) };
}
const body = { currentPassword: 'old-password-123', newPassword: 'new-password-456', confirmPassword: 'new-password-456' };
test('app-lock recovery verifies the current account session and password without modifying data', t => {
  const { db, service } = setup(t);
  assert.throws(() => service.verifyAccountPassword('a', 'b1', { currentPassword: body.currentPassword }), /登录/);
  for (const currentPassword of ['bad-password', '', null, 'x'.repeat(129)]) assert.throws(() => service.verifyAccountPassword('a', 'a1', { currentPassword }));
  assert.deepEqual(service.verifyAccountPassword('a', 'a1', { currentPassword: body.currentPassword }), { verified: true });
  db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run('2000-01-01T00:00:00Z', tokenHash('a1'));
  assert.throws(() => service.verifyAccountPassword('a', 'a1', { currentPassword: body.currentPassword }), /登录/);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 4);
});
test('account profile migration is repeatable, partial edits are scoped and reject invalid or protected fields', t => {
  const { db, service } = setup(t);
  createAccountServices(db);
  service.updateProfile('a', { name: '  新昵称  ', gender: 'female' });
  const user = service.updateProfile('a', { avatar: '' });
  assert.equal(user.name, '新昵称');
  assert.equal(user.gender, 'female');
  assert.equal(db.prepare("SELECT name FROM users WHERE id='b'").get().name, 'Original');
  for (const invalid of [{}, [], { name: '' }, { name: '字'.repeat(25) }, { gender: 'invalid' }, { name: '不可保存', gender: 'invalid' },
    { id: 'b' }, { username: 'changed' }, { password: 'changed' }, { avatar: 'https://example.test/avatar.jpg' },
    { avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, { avatar: 'data:image/jpeg;base64,YmFk' }, { avatar: 'a'.repeat(128 * 1024 + 1) }]) {
    assert.throws(() => service.updateProfile('a', invalid));
    assert.equal(db.prepare("SELECT name FROM users WHERE id='a'").get().name, '新昵称');
  }
  assert.throws(() => service.updateProfile('missing', { gender: '' }), /账号不存在/);
});
test('password change verifies original password, keeps current login, revokes others and scopes to account', t => {
  const { db, service } = setup(t);
  for (const invalid of [{ ...body, currentPassword: 'wrong' }, { ...body, confirmPassword: 'different' }, { ...body, newPassword: 'short', confirmPassword: 'short' }, { ...body, newPassword: body.currentPassword, confirmPassword: body.currentPassword }]) {
    assert.throws(() => service.changePassword('a', 'a1', invalid));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='a'").get().n, 2);
  }
  assert.throws(() => service.changePassword('a', 'b1', body), /登录/);
  service.changePassword('a', 'a1', body);
  assert.equal(verifyPassword(body.newPassword, db.prepare("SELECT password FROM users WHERE id='a'").get().password), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='a'").get().n, 1);
  assert.ok(db.prepare('SELECT hash FROM sessions WHERE hash=?').get(tokenHash('a1')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='b'").get().n, 2);
  assert.throws(() => service.changePassword('a', 'a2', { ...body, currentPassword: body.newPassword }), /登录/);
});
test('password and session changes roll back together on storage failure', t => {
  const { db, service } = setup(t);
  db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(() => service.changePassword('a', 'a1', body), /fixture failure/);
  assert.equal(verifyPassword(body.currentPassword, db.prepare("SELECT password FROM users WHERE id='a'").get().password), true);
});
test('feedback validates input, deduplicates retries, preserves account isolation and limits daily submissions', t => {
  const { service } = setup(t);
  const feedback = { requestId: 'fixture-feedback-001', category: '功能建议', content: '希望增加更多记账统计', contact: '' };
  for (const invalid of [{ ...feedback, content: '短' }, { ...feedback, content: 'a'.repeat(1001) }, { ...feedback, category: '未知' }, { ...feedback, contact: 'x'.repeat(101) }]) assert.throws(() => service.submitFeedback('a', invalid));
  const result = service.submitFeedback('a', feedback);
  assert.deepEqual(service.submitFeedback('a', feedback), result);
  assert.throws(() => service.submitFeedback('a', { ...feedback, content: '不同的反馈内容' }), /内容已变化/);
  assert.equal(service.listFeedback('a').length, 1);
  assert.deepEqual(service.listFeedback('b'), []);
  for (let i = 2; i <= 10; i++) service.submitFeedback('a', { ...feedback, requestId: `fixture-feedback-${i}` });
  assert.throws(() => service.submitFeedback('a', { ...feedback, requestId: 'fixture-feedback-011' }), /最多提交/);
  assert.deepEqual(service.submitFeedback('a', feedback), result, 'retry works even after daily quota');
  assert.ok(service.submitFeedback('b', feedback).id);
});
