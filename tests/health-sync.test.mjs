import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHealthSyncStore } from '../server/health-sync.mjs';

test('sync preferences persist by account without granting access or creating device data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('a'),('b');");
    const store = createHealthSyncStore(db);
    const initial = store.state('a');
    assert.equal(initial.metrics.length, 5);
    assert.equal(initial.cloudAuthorized, false);
    assert.ok(initial.sources.every(source => source.status === 'unavailable' && source.lastSync === null));
    store.save('a', { metrics: ['sleep', 'steps'], revision: 0 });
    assert.deepEqual(createHealthSyncStore(db).state('a').metrics, ['steps', 'sleep']);
    assert.equal(store.state('b').revision, 0);
    assert.throws(() => store.save('a', { metrics: [], revision: 0 }), /已更新/);
    for (const metrics of [['invalid'], ['sleep', 'sleep'], null]) {
      assert.throws(() => store.save('a', { metrics, revision: 1 }), /格式无效/);
    }
    assert.throws(() => store.save('a', { metrics: [], revision: 1, cloudAuthorized: true }), /格式无效/);
    assert.throws(() => store.save('a', { metrics: [], revision: 1, token: 'fake' }), /格式无效/);
    assert.throws(() => store.state('missing'), /不存在/);
    store.save('a', { metrics: [], revision: 1 });
    assert.deepEqual(store.state('a').metrics, []);
    db.prepare('DELETE FROM users WHERE id=?').run('a');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_sync_preferences').get().n, 0);
  } finally { db.close(); }
});
