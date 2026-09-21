import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTaskPhotoStore } from '../server/task-photos.mjs';
import { validateRecord } from '../server/domain.mjs';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
test('task photos are owner scoped, deduplicated and removed with the account', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b')");
    const store = createTaskPhotoStore(db);
    const saved = store.save('a', image);
    assert.equal(store.save('a', image).id, saved.id);
    assert.equal(store.get('a', saved.id).image, image);
    assert.throws(() => store.get('b', saved.id));
    assert.throws(() => store.check('b', { photos: [saved.id] }));
    assert.equal(store.check('a', { photos: [saved.id] }).photos[0], saved.id);
    assert.notEqual(store.save('b', image).id, saved.id);
    assert.throws(() => store.save('a', 'data:image/svg+xml;base64,AAAA'));
    assert.throws(() => store.save('a', `data:image/jpeg;base64,${'A'.repeat(850000)}`));
    assert.throws(() => validateRecord('task', { title: 'a', photos: [saved.id, saved.id] }));
    assert.throws(() => validateRecord('task', { title: 'a', photos: [image] }));
    db.prepare('DELETE FROM users WHERE id=?').run('a');
    assert.throws(() => store.get('a', saved.id));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM task_photos').get().n, 1);
  } finally { db.close(); }
});
