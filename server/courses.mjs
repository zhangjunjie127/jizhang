import { defaultCourseSettings } from '../shared/courses.mjs';
import { weekday } from '../shared/planner.mjs';
import { validCalendarDate } from '../shared/calendar.mjs';
import { cleanText, fail, iso } from './domain.mjs';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function coursePhotos(value = []) {
  if (!Array.isArray(value) || value.length > 6 || value.some(id => typeof id !== 'string' || !uuid.test(id)) ||
    new Set(value).size !== value.length) fail('照片格式无效，最多6张');
  return value;
}
export function createCourseStore(db, getCourse, photoStore) {
  db.exec(`CREATE TABLE IF NOT EXISTS course_settings(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS course_events(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES planner_items(id) ON DELETE CASCADE,
    source_date TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS course_event_user ON course_events(user_id,course_id,source_date);`);
  function settings(userId) {
    const row = db.prepare('SELECT * FROM course_settings WHERE user_id=?').get(userId);
    return row ? { ...JSON.parse(row.payload), revision: row.revision } : defaultCourseSettings();
  }
  function events(userId) {
    return db.prepare(`SELECT e.* FROM course_events e JOIN planner_items p ON e.course_id=p.id
      WHERE e.user_id=? AND p.deleted_at IS NULL ORDER BY e.rowid`).all(userId)
      .map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  function saveSettings(userId, body) {
    if (!body || body.revision !== settings(userId).revision) fail('作息设置已变化，请刷新后重试', 409);
    const p = body;
    if (!Array.isArray(p.bells) || !p.bells.length || p.bells.length > 20) fail('请设置1至20节课');
    let previous = '';
    const bells = p.bells.map(bell => {
      if (!bell || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(bell.start) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(bell.end) || bell.start >= bell.end || bell.start < previous) fail('作息时间需按顺序排列且不能重叠');
      previous = bell.end;
      return { start: bell.start, end: bell.end };
    });
    if (typeof p.confirmed !== 'boolean' || typeof p.reminders !== 'boolean' ||
      !Number.isInteger(p.leadMinutes) || p.leadMinutes < 0 || p.leadMinutes > 120) fail('提醒设置无效');
    const myTeacher = p.myTeacher ? cleanText(p.myTeacher, 40, '我的姓名') : '';
    if (p.reminders && (!p.confirmed || !myTeacher)) fail('开启提醒前请填写我的姓名并确认作息时间');
    const payload = { bells, myTeacher, confirmed: p.confirmed, reminders: p.reminders, leadMinutes: p.leadMinutes };
    db.prepare(`INSERT INTO course_settings(user_id,payload,revision) VALUES(?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=course_settings.revision+1`).run(userId, JSON.stringify(payload));
  }
  function saveLesson(userId, id, body) {
    const course = getCourse(userId, id);
    if (course.kind !== 'course') fail('只有课程可以调整');
    if (!body || !uuid.test(body.requestId || '') || !validCalendarDate(body.sourceDate)) fail('原上课日期无效');
    const last = db.prepare('SELECT id FROM course_events WHERE user_id=? AND course_id=? AND source_date=? ORDER BY rowid DESC LIMIT 1').get(userId, id, body.sourceDate);
    if (!last && !course.payload.weekdays.includes(weekday(body.sourceDate))) fail('原上课日期无效');
    const p = body.payload;
    if (!p || !validCalendarDate(p.date) || !Number.isInteger(p.order) || p.order < 1 || p.order > 20 ||
      typeof p.cancelled !== 'boolean') fail('调整日期或节次无效');
    const payload = { date: p.date, order: p.order, cancelled: p.cancelled,
      teacher: p.teacher ? cleanText(p.teacher, 40, '老师') : '',
      room: p.room ? cleanText(p.room, 60, '教室') : '',
      note: p.note ? cleanText(p.note, 2000, '课堂备注') : '',
      reason: p.reason ? cleanText(p.reason, 200, '变更原因') : '',
      photos: coursePhotos(p.photos) };
    photoStore.check(userId, payload);
    const prior = db.prepare('SELECT * FROM course_events WHERE id=?').get(body.requestId);
    if (prior) {
      if (prior.user_id !== userId || prior.course_id !== id || prior.source_date !== body.sourceDate ||
        prior.payload !== JSON.stringify(payload)) fail('提交标识已使用', 409);
      return;
    }
    if ((body.revision || '') !== (last?.id || '')) fail('本节课已变化，请刷新后重试', 409);
    db.prepare('INSERT INTO course_events VALUES(?,?,?,?,?,?)').run(body.requestId, userId, id, body.sourceDate, JSON.stringify(payload), iso());
  }
  return { settings, events, saveSettings, saveLesson };
}
