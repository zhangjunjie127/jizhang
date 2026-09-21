import { randomUUID } from 'node:crypto';
import { cleanText, fail, iso, passwordHash, tokenHash, verifyPassword } from './domain.mjs';

export function createAccountServices(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.some(column => column.name === 'avatar')) db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  if (!columns.some(column => column.name === 'gender')) db.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL,
    contact TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(user_id,request_id)
  );
  CREATE INDEX IF NOT EXISTS feedback_user ON feedback(user_id,created);`);
  function updateProfile(userId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求格式无效');
    const keys = Object.keys(body);
    if (!keys.length || keys.some(key => !['name', 'gender', 'avatar'].includes(key))) fail('只能修改头像、昵称和性别');
    const updates = {};
    if (Object.hasOwn(body, 'name')) updates.name = cleanText(body.name, 24, '昵称');
    if (Object.hasOwn(body, 'gender')) {
      if (!['', 'male', 'female'].includes(body.gender)) fail('性别选项无效');
      updates.gender = body.gender;
    }
    if (Object.hasOwn(body, 'avatar')) {
      if (typeof body.avatar !== 'string' || body.avatar.length > 128 * 1024) fail('头像需小于 128KB', 413);
      if (body.avatar) {
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.avatar);
        if (!match || match[1].length % 4) fail('请选择有效的 JPG 头像');
        const image = Buffer.from(match[1], 'base64');
        if (image.length < 128 || !image.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
          !image.subarray(-2).equals(Buffer.from([255, 217]))) fail('头像图片内容无效');
      }
      updates.avatar = body.avatar;
    }
    // Column names come only from the validated field list, never from arbitrary input.
    const fields = Object.keys(updates);
    const result = db.prepare(`UPDATE users SET ${fields.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...fields.map(key => updates[key]), userId);
    if (!result.changes) fail('账号不存在', 404);
    return db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  }
  function changePassword(userId, token, body) {
    if (!body || typeof body !== 'object') fail('请求格式无效');
    // Re-read after receiving the body, so an old session cannot race a password change.
    const user = db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.hash=? AND s.expires>?`).get(userId, tokenHash(token), iso());
    if (!user) fail('登录已过期，请重新登录', 401);
    if (!verifyPassword(body.currentPassword, user.password)) fail('当前密码不正确');
    if (body.newPassword !== body.confirmPassword) fail('两次新密码不一致');
    if (body.newPassword === body.currentPassword) fail('新密码不能与当前密码相同');
    const hash = passwordHash(body.newPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, userId);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(userId, tokenHash(token));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true };
  }
  function verifyAccountPassword(userId, token, body) {
    const user = db.prepare(`SELECT u.password FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.hash=? AND s.expires>?`).get(userId, tokenHash(token), iso());
    if (!user) fail('登录已过期，请重新登录后重置应用锁', 401);
    if (!body || typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 ||
      !verifyPassword(body.currentPassword, user.password)) fail('账号密码不正确');
    return { verified: true };
  }
  function submitFeedback(userId, body) {
    if (!body || typeof body !== 'object') fail('请求格式无效');
    const requestId = cleanText(body.requestId, 80, '提交编号');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('提交编号无效');
    if (!['问题反馈', '功能建议', '其他'].includes(body.category)) fail('反馈类型无效');
    const content = cleanText(body.content, 1000, '反馈内容');
    if (content.length < 5) fail('反馈内容至少填写 5 个字');
    const contact = body.contact === undefined || body.contact === '' ? '' : cleanText(body.contact, 100, '联系方式');
    const prior = db.prepare('SELECT * FROM feedback WHERE user_id=? AND request_id=?').get(userId, requestId);
    if (prior) {
      if (prior.category !== body.category || prior.content !== content || prior.contact !== contact) fail('提交内容已变化，请重新提交', 409);
      return { id: prior.id, created: prior.created };
    }
    const since = new Date(Date.now() - 86400000).toISOString();
    if (db.prepare('SELECT COUNT(*) AS count FROM feedback WHERE user_id=? AND created>?').get(userId, since).count >= 10) fail('24 小时内最多提交 10 条反馈，请稍后再试', 429);
    const id = randomUUID(), created = iso();
    db.prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?,?)').run(id, userId, requestId, body.category, content, contact, created);
    return { id, created };
  }
  function listFeedback(userId) {
    return db.prepare('SELECT id,category,content,created FROM feedback WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 20').all(userId);
  }
  return { changePassword, verifyAccountPassword, submitFeedback, listFeedback, updateProfile };
}
