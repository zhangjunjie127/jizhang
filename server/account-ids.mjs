import { randomInt } from 'node:crypto';

const NUMERIC_ACCOUNT_ID = /^\d{10}$/;
const MIN_ACCOUNT_ID = 1_000_000_000;
const MAX_ACCOUNT_ID = 10_000_000_000;

function quoted(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createAccountId(db) {
  const used = new Set(db.prepare('SELECT id FROM users').all().map(row => String(row.id)));
  let id;
  do { id = String(randomInt(MIN_ACCOUNT_ID, MAX_ACCOUNT_ID)); } while (used.has(id));
  return id;
}

export function migrateAccountIds(db) {
  const users = db.prepare('SELECT id FROM users ORDER BY rowid').all();
  const used = new Set(users.map(row => String(row.id)));
  const changes = [];
  for (const user of users) {
    const oldId = String(user.id);
    if (NUMERIC_ACCOUNT_ID.test(oldId)) continue;
    let nextId;
    do { nextId = String(randomInt(MIN_ACCOUNT_ID, MAX_ACCOUNT_ID)); } while (used.has(nextId));
    used.add(nextId);
    changes.push({ oldId, nextId });
  }
  if (!changes.length) return { changed: 0 };

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .map(row => row.name)
    .filter(name => name !== 'users')
    .filter(name => db.prepare(`PRAGMA table_info(${quoted(name)})`).all().some(column => column.name === 'user_id'));
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    for (const { oldId, nextId } of changes) {
      for (const table of tables) db.prepare(`UPDATE ${quoted(table)} SET user_id=? WHERE user_id=?`).run(nextId, oldId);
      db.prepare('UPDATE users SET id=? WHERE id=?').run(nextId, oldId);
    }
    db.exec('COMMIT; PRAGMA foreign_keys=ON;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } finally { db.exec('PRAGMA foreign_keys=ON;'); }
    throw error;
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`账户 ID 迁移后存在 ${violations.length} 条外键异常`);
  return { changed: changes.length };
}

export { NUMERIC_ACCOUNT_ID };
