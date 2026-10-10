import { fail, iso } from './domain.mjs';
import { HEALTH_METRICS, HEALTH_SOURCES } from '../shared/health-sync.mjs';

// Preferences only: no provider credentials or health samples are accepted yet.
export function createHealthSyncStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS health_sync_preferences(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    metrics TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL);`);
  function state(userId) {
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) fail('账号不存在', 404);
    const row = db.prepare('SELECT * FROM health_sync_preferences WHERE user_id=?').get(userId);
    return {
      metrics: row ? JSON.parse(row.metrics) : Object.keys(HEALTH_METRICS),
      revision: row?.revision ?? 0, updated: row?.updated ?? null,
      cloudAuthorized: false,
      sources: HEALTH_SOURCES.map(source => ({ ...source, status: 'unavailable', lastSync: null })),
    };
  }
  function save(userId, body) {
    const current = state(userId);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['metrics', 'revision'].includes(key)) ||
        !Array.isArray(body.metrics) || body.metrics.length > Object.keys(HEALTH_METRICS).length ||
        body.metrics.some(metric => !Object.hasOwn(HEALTH_METRICS, metric)) ||
        new Set(body.metrics).size !== body.metrics.length) fail('同步偏好格式无效');
    if (!Number.isInteger(body.revision) || body.revision !== current.revision) fail('设置已更新，请刷新后重试', 409);
    const metrics = Object.keys(HEALTH_METRICS).filter(metric => body.metrics.includes(metric));
    db.prepare(`INSERT INTO health_sync_preferences(user_id,metrics,revision,updated) VALUES(?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET metrics=excluded.metrics,revision=excluded.revision,updated=excluded.updated`)
      .run(userId, JSON.stringify(metrics), current.revision + 1, iso());
    return state(userId);
  }
  return { state, save };
}
