const ACCOUNT_FIELDS = [
  'id', 'username', 'name', 'birthday', 'gender', 'avatar', 'persona',
  'relationship', 'proactive', 'quiet_until', 'last_checkin', 'created',
];

const USER_TABLES = [
  'records', 'messages', 'memories', 'usage', 'feedback',
  'account_deletion_requests', 'checkins', 'debt_people', 'debt_bills',
  'debt_payments', 'planner_items', 'planner_anniversaries', 'course_settings',
  'course_events', 'health_entries', 'health_settings', 'health_sync_preferences',
  'task_photos',
];

export function accountExport(db, userId, exportedAt = new Date().toISOString()) {
  const user = db.prepare(`SELECT ${ACCOUNT_FIELDS.join(',')} FROM users WHERE id=?`).get(userId);
  if (!user) throw new Error('账号不存在');

  const exists = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const data = Object.fromEntries(USER_TABLES
    .filter(table => exists.has(table))
    .map(table => [
      table,
      db.prepare(`SELECT * FROM "${table}" WHERE user_id=? ORDER BY rowid`).all(userId),
    ]));

  if (exists.has('planner_checks') && exists.has('planner_items')) {
    data.planner_checks = db.prepare(`SELECT c.item_id,c.date,c.created
      FROM planner_checks c JOIN planner_items p ON p.id=c.item_id
      WHERE p.user_id=? ORDER BY c.date,c.item_id`).all(userId);
  }
  if (exists.has('assistant_actions')) {
    data.assistant_actions = db.prepare(`SELECT id,operation,args,summary,status,created,expires,presented,result
      FROM assistant_actions WHERE user_id=? ORDER BY created,id`).all(userId);
  }

  return {
    format: 'zaizai-account-export',
    version: 1,
    exportedAt,
    account: user,
    data,
    excluded: ['password hashes', 'login sessions', 'temporary action authorizations', 'device-local preferences'],
  };
}
