import { cleanText, fail, iso } from './domain.mjs';
import { PLANNER_TONES, HABIT_ICONS, HABIT_REPEATS, plannerToday, habitScheduled } from '../shared/planner.mjs';
import { validCalendarDate } from '../shared/calendar.mjs';
import { createCourseStore, coursePhotos } from './courses.mjs';
import { createTaskPhotoStore } from './task-photos.mjs';
import { EDUCATION } from '../shared/education.mjs';

export function validatePlanner(kind, input) {
  if (!['habit', 'course', 'anniversary'].includes(kind) || !input || typeof input !== 'object') fail('日程类型无效');
  if (kind === 'anniversary') {
    if (!validCalendarDate(input.date)) fail('请选择1901至2100年间的有效日期');
    if (!['solar', 'lunar'].includes(input.calendar) || !['once', 'yearly'].includes(input.repeat)) fail('纪念日重复方式无效');
    if (!PLANNER_TONES.includes(input.tone)) fail('请选择有效的颜色');
    return { title: cleanText(input.title, 80, '纪念日名称'), date: input.date, calendar: input.calendar,
      repeat: input.repeat, tone: input.tone, note: input.note ? cleanText(input.note, 500, '备注') : '' };
  }
  const title = cleanText(input.title, 80, kind === 'habit' ? '习惯名称' : '课程名称');
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.length > 7 ||
    input.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(input.weekdays).size !== input.weekdays.length) fail('请选择有效的重复星期');
  if (!PLANNER_TONES.includes(input.tone)) fail('请选择有效的颜色');
  const payload = { title, weekdays: [...input.weekdays].sort(), tone: input.tone, note: input.note ? cleanText(input.note, 500, '备注') : '' };
  if (kind === 'habit') {
    if (!HABIT_ICONS.includes(input.icon)) fail('请选择有效的习惯图标');
    payload.icon = input.icon;
    const repeat = input.repeat ?? 'weekly';
    if (!HABIT_REPEATS.some(([value]) => value === repeat)) fail('重复周期无效');
    const monthDays = input.monthDays ?? [1];
    if (!Array.isArray(monthDays) || !monthDays.length || monthDays.length > 31 ||
      monthDays.some(day => !Number.isInteger(day) || day < 1 || day > 31) ||
      new Set(monthDays).size !== monthDays.length) fail('请选择有效的每月日期');
    const targetCount = input.targetCount ?? 1;
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > (repeat === 'week-flex' ? 7 : 31)) fail('目标次数无效');
    const startDate = input.startDate ?? '', endDate = input.endDate ?? '';
    if ((startDate !== '' && !validCalendarDate(startDate)) || (endDate !== '' && !validCalendarDate(endDate)) ||
      (endDate && endDate < (startDate || plannerToday()))) fail('目标起止日期无效');
    for (const key of ['skipHolidays', 'focus']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('开关设置无效');
    const focusMinutes = input.focusMinutes ?? 25;
    if (!Number.isInteger(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) fail('专注时长需为1至180分钟');
    const reminders = input.reminders ?? [];
    if (!Array.isArray(reminders) || reminders.length > 8 ||
      reminders.some(time => typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) ||
      new Set(reminders).size !== reminders.length) fail('提醒时间需为不同的24小时制时间，最多8个');
    Object.assign(payload, { repeat, monthDays: [...monthDays].sort((a, b) => a - b), targetCount,
      startDate, endDate, skipHolidays: input.skipHolidays ?? false, focus: input.focus ?? false,
      focusMinutes, reminders: [...reminders].sort() });
  } else {
    if (!Number.isInteger(input.order) || input.order < 1 || input.order > 20) fail('课程顺序需为1至20');
    payload.order = input.order;
    const stage = input.stage || '', grade = input.grade || '';
    if (stage && !Object.hasOwn(EDUCATION, stage)) fail('请选择有效的学段');
    if (grade && !EDUCATION[stage]?.includes(grade)) fail('请选择该学段的年级');
    if (stage) payload.stage = stage;
    if (grade) payload.grade = grade;
    payload.teacher = input.teacher ? cleanText(input.teacher, 40, '老师') : '';
    payload.room = input.room ? cleanText(input.room, 60, '教室') : '';
    payload.className = input.className ? cleanText(input.className, 40, '班级') : '';
    payload.photos = coursePhotos(input.photos);
  }
  return payload;
}

export function createPlannerStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS planner_items(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('habit','course')), payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS planner_user ON planner_items(user_id,deleted_at);
  CREATE TABLE IF NOT EXISTS planner_checks(
    item_id TEXT NOT NULL REFERENCES planner_items(id) ON DELETE CASCADE,
    date TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(item_id,date)
  );
  CREATE TABLE IF NOT EXISTS planner_anniversaries(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind='anniversary'), payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS planner_anniversary_user ON planner_anniversaries(user_id,deleted_at);`);
  const tableFor = kind => kind === 'anniversary' ? 'planner_anniversaries' : 'planner_items';
  const allItems = '(SELECT * FROM planner_items UNION ALL SELECT * FROM planner_anniversaries)';
  const decode = item => ({ ...item, payload: JSON.parse(item.payload) });
  const photoStore = createTaskPhotoStore(db);
  const courses = createCourseStore(db, get, photoStore);
  function get(userId, id) {
    const item = db.prepare(`SELECT * FROM ${allItems} WHERE user_id=? AND id=? AND deleted_at IS NULL`).get(userId, id);
    if (!item) fail('记录不存在或已删除', 404);
    return decode(item);
  }
  function state(userId) {
    return {
      courseSettings: courses.settings(userId), courseEvents: courses.events(userId),
      items: db.prepare(`SELECT * FROM ${allItems} WHERE user_id=? AND deleted_at IS NULL ORDER BY created,id`).all(userId).map(decode),
      checks: db.prepare(`SELECT c.item_id,c.date FROM planner_checks c JOIN planner_items p ON p.id=c.item_id
        WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY c.date DESC`).all(userId),
    };
  }
  function save(userId, body, id) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('日程数据格式无效');
    const existing = id ? get(userId, id) : null;
    const kind = existing?.kind || body.kind;
    const payload = validatePlanner(kind, body.payload);
    if (kind === 'course') photoStore.check(userId, payload);
    const table = tableFor(kind);
    if (existing) {
      if (body.revision !== existing.revision) fail('记录已变化，请刷新后重试', 409);
      db.prepare(`UPDATE ${table} SET payload=?,revision=revision+1 WHERE id=? AND user_id=?`).run(JSON.stringify(payload), id, userId);
    } else {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(body.requestId || '')) fail('提交标识无效');
      const prior = db.prepare(`SELECT * FROM ${allItems} WHERE id=?`).get(body.requestId);
      if (prior) {
        if (prior.user_id !== userId || prior.kind !== kind || prior.payload !== JSON.stringify(payload) || prior.deleted_at) fail('提交已处理，请刷新', 409);
      } else {
        if (db.prepare(`SELECT COUNT(*) AS n FROM ${allItems} WHERE user_id=? AND deleted_at IS NULL`).get(userId).n >= 500) fail('日程数量已达到上限');
        db.prepare(`INSERT INTO ${table}(id,user_id,kind,payload,created) VALUES (?,?,?,?,?)`).run(body.requestId, userId, kind, JSON.stringify(payload), iso());
      }
    }
    return state(userId);
  }
  function remove(userId, id, body) {
    if (!body || typeof body !== 'object') fail('日程数据格式无效');
    const item = get(userId, id);
    if (body.revision !== item.revision) fail('记录已变化，请刷新后重试', 409);
    db.prepare(`UPDATE ${tableFor(item.kind)} SET deleted_at=?,revision=revision+1 WHERE id=? AND user_id=?`).run(iso(), id, userId);
    return state(userId);
  }
  function check(userId, id, body, today = plannerToday()) {
    if (!body || typeof body !== 'object') fail('打卡数据格式无效');
    const item = get(userId, id);
    const { date, checked } = body;
    if (item.kind !== 'habit') fail('只有习惯可以打卡');
    if (typeof checked !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
      date > today || date < '1901-01-01') fail('打卡日期无效');
    const prior = db.prepare('SELECT 1 FROM planner_checks WHERE item_id=? AND date=?').get(id, date);
    if (checked && !prior && !habitScheduled(item, date)) fail('当天没有安排此习惯');
    if (checked) db.prepare('INSERT OR IGNORE INTO planner_checks(item_id,date,created) VALUES (?,?,?)').run(id, date, iso());
    else db.prepare('DELETE FROM planner_checks WHERE item_id=? AND date=?').run(id, date);
    return state(userId);
  }
  return { state, save, remove, check,
    saveCourseBatch(userId, body) {
      if (!Array.isArray(body?.entries) || !body.entries.length || body.entries.length > 20) fail('请选择1至20个课时');
      if (body.entries.some(entry => entry.kind !== 'course' || entry.payload?.weekdays?.length !== 1)) fail('每次只能安排一个星期');
      db.exec('SAVEPOINT course_batch');
      try {
        for (const entry of body.entries) save(userId, entry, entry.id);
        db.exec('RELEASE course_batch');
        return state(userId);
      } catch (error) { db.exec('ROLLBACK TO course_batch'); db.exec('RELEASE course_batch'); throw error; }
    },
    saveCourseSettings(userId, body) { courses.saveSettings(userId, body); return state(userId); },
    saveLesson(userId, id, body) { courses.saveLesson(userId, id, body); return state(userId); } };
}
