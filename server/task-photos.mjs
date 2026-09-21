import { randomUUID } from 'node:crypto';
import { receiptImage } from './receipt.mjs';
import { fail } from './domain.mjs';

export function createTaskPhotoStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS task_photos (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image TEXT NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL,
    UNIQUE(user_id, hash)
  )`);
  return {
    save(userId, image) {
      if (typeof image !== 'string' || image.length > 850000) fail('照片过大，请重新选择', 413);
      const valid = receiptImage(image);
      const existing = db.prepare('SELECT id FROM task_photos WHERE user_id=? AND hash=?').get(userId, valid.imageHash);
      if (existing) return existing;
      const used = db.prepare('SELECT COALESCE(SUM(length(image)),0) AS size FROM task_photos WHERE user_id=?').get(userId).size;
      if (used + image.length > 100 * 1024 * 1024) fail('照片留档空间已满', 413);
      const id = randomUUID();
      db.prepare('INSERT INTO task_photos VALUES (?,?,?,?,?)').run(id, userId, image, valid.imageHash, new Date().toISOString());
      return { id };
    },
    get(userId, id) {
      const photo = db.prepare('SELECT image FROM task_photos WHERE user_id=? AND id=?').get(userId, id);
      if (!photo) fail('照片不存在', 404);
      return photo;
    },
    check(userId, payload) {
      for (const id of payload.photos || []) {
        if (!db.prepare('SELECT id FROM task_photos WHERE user_id=? AND id=?').get(userId, id)) fail('照片不存在，请重新添加');
      }
      return payload;
    },
  };
}
