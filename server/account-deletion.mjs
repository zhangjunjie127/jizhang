import { randomUUID } from 'node:crypto';
import { cleanText, fail, iso, tokenHash, verifyPassword } from './domain.mjs';

export function createAccountDeletionStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','cancelled','rejected')),
    created TEXT NOT NULL, reviewed_at TEXT, reason TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_pending ON account_deletion_requests(user_id) WHERE status='pending';`);
  function latest(userId) {
    return db.prepare('SELECT id,status,created,reviewed_at,reason FROM account_deletion_requests WHERE user_id=? ORDER BY rowid DESC LIMIT 1').get(userId) || null;
  }
  function submit(userId, token, body) {
    if (!body || body.confirmation !== '申请注销' || body.acknowledged !== true) fail('请确认注销说明后再次提交');
    const user = db.prepare(`SELECT u.password FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.hash=? AND s.expires>?`).get(userId, tokenHash(token), iso());
    if (!user) fail('登录已过期，请重新登录', 401);
    if (!verifyPassword(body.currentPassword, user.password)) fail('当前密码不正确');
    const existing = latest(userId);
    if (existing?.status === 'pending') return existing;
    db.prepare("INSERT INTO account_deletion_requests(id,user_id,status,created) VALUES (?,?,'pending',?)").run(randomUUID(), userId, iso());
    return latest(userId);
  }
  function cancel(userId, id) {
    const result = db.prepare("UPDATE account_deletion_requests SET status='cancelled',reviewed_at=? WHERE id=? AND user_id=? AND status='pending'").run(iso(), id, userId);
    if (!result.changes) fail('申请已处理或不存在，请刷新状态', 409);
    return latest(userId);
  }
  function pending() {
    return db.prepare(`SELECT r.id,r.user_id,u.username,r.created FROM account_deletion_requests r
      JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created`).all();
  }
  // Local administrator only. Never expose this method through user or AI routes.
  function review(id, expectedUserId, decision, reason = '') {
    if (!['approve', 'reject'].includes(decision)) fail('审核决定无效');
    if (decision === 'reject') reason = cleanText(reason, 200, '驳回原因');
    db.exec('BEGIN IMMEDIATE');
    try {
      const application = db.prepare("SELECT * FROM account_deletion_requests WHERE id=? AND status='pending'").get(id);
      if (!application || application.user_id !== expectedUserId) fail('待审核申请与确认的账号不匹配', 409);
      if (decision === 'reject') {
        db.prepare("UPDATE account_deletion_requests SET status='rejected',reviewed_at=?,reason=? WHERE id=?").run(iso(), reason, id);
      } else {
        // Explicit ordering covers linked repayments and the non-cascading action log.
        for (const table of ['assistant_actions', 'debt_payments', 'debt_bills', 'debt_people', 'checkins', 'records', 'messages', 'memories', 'usage', 'feedback', 'sessions', 'account_deletion_requests']) {
          if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(expectedUserId);
        }
        db.prepare('DELETE FROM users WHERE id=?').run(expectedUserId);
      }
      db.exec('COMMIT');
      return { id, decision };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { latest, submit, cancel, pending, review };
}
