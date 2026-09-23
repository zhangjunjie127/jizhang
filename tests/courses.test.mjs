import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createPlannerStore } from '../server/planner.mjs';
import { courseLessons, courseSubstitutions, courseConflicts, courseReminders, courseTone, defaultCourseSettings, lessonTime } from '../shared/courses.mjs';

test('same course title keeps one stable color across continuous periods and records', () => {
  assert.equal(courseTone('语文'), courseTone('语文'));
  assert.equal(courseTone('  校本课程  '), courseTone('校本课程'));
  assert.notEqual(courseTone('校本课程A'), courseTone('校本课程B'));
});

test('substitution records derive only from the latest active teacher replacement', () => {
  const items = [{ id: 'c', kind: 'course', payload: { teacher: '李老师' } }];
  const event = (id, teacher, extra = {}) => ({ id, course_id: 'c', source_date: '2026-09-21', payload: { teacher, ...extra } });
  const replacement = event('1', '王老师');
  assert.deepEqual(courseSubstitutions(items, [replacement]), [replacement]);
  const updated = event('2', '张老师', { note: '备注' });
  assert.deepEqual(courseSubstitutions(items, [replacement, updated]), [updated]);
  for (const last of [event('3', '李老师'), event('3', ''), event('3', '王老师', { cancelled: true })]) {
    assert.deepEqual(courseSubstitutions(items, [replacement, last]), []);
  }
  assert.deepEqual(courseSubstitutions(items, [event('1', '李老师', { order: 3, note: '仅调课' })]), []);
  assert.deepEqual(courseSubstitutions([], [replacement]), []);
  assert.deepEqual(courseSubstitutions([{ ...items[0], deleted_at: '2026-09-23' }], [replacement]), []);
  assert.deepEqual(courseSubstitutions([{ ...items[0], payload: { teacher: '' } }], [replacement]), []);
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('a'),('b')");
  const store = createPlannerStore(db), id = randomUUID();
  const payload = { title: '数学', className: '七年级一班', teacher: '李老师', room: '101', tone: 'blue', order: 1, weekdays: [0] };
  store.save('a', { requestId: id, kind: 'course', payload });
  return { db, store, id, payload };
}
test('course settings default off, validate time order and require confirmed identity for reminders', () => {
  const { db, store } = fixture();
  try {
    assert.equal(store.state('a').courseSettings.reminders, false);
    assert.throws(() => store.saveCourseSettings('a', { ...defaultCourseSettings(), reminders: true }));
    assert.throws(() => store.saveCourseSettings('a', { ...defaultCourseSettings(), bells: [{ start: '09:00', end: '08:00' }] }));
    assert.throws(() => store.saveCourseSettings('a', { ...defaultCourseSettings(), bells: [{ start: '08:00', end: '09:00' }, { start: '08:30', end: '09:30' }] }));
    store.saveCourseSettings('a', { ...defaultCourseSettings(), myTeacher: '李老师', confirmed: true, reminders: true });
    assert.equal(store.state('a').courseSettings.revision, 1);
    assert.equal(store.state('b').courseSettings.reminders, false);
    assert.throws(() => store.saveCourseSettings('a', defaultCourseSettings()));
  } finally { db.close(); }
});
test('single course moves across weeks, substitutes, cancellation and restoration preserve recurrence and audit history', () => {
  const { db, store, id, payload } = fixture();
  try {
    const body = { requestId: randomUUID(), sourceDate: '2026-09-21', revision: '',
      payload: { date: '2026-09-29', order: 2, teacher: '王老师', room: '202', note: '讲到第二章', photos: [], reason: '代课', cancelled: false } };
    store.saveLesson('a', id, body);
    store.saveLesson('a', id, body);
    assert.equal(store.state('a').courseEvents.length, 1);
    assert.equal(store.state('a').items[0].payload.teacher, payload.teacher);
    assert.throws(() => store.saveLesson('a', id, { ...body, requestId: randomUUID() }));
    assert.throws(() => store.saveLesson('b', id, body));
    const state = store.state('a');
    assert.equal(courseLessons(state.items, state.courseEvents, '2026-09-21', '2026-09-27').length, 0);
    const next = courseLessons(state.items, state.courseEvents, '2026-09-28', '2026-10-04');
    assert.equal(next.length, 2);
    assert.equal(next[1].teacher, '王老师');
    assert.equal(next[0].teacher, '李老师');
    const cancelled = { ...body, requestId: randomUUID(), revision: body.requestId, payload: { ...body.payload, cancelled: true } };
    store.saveLesson('a', id, cancelled);
    const after = store.state('a');
    assert.equal(courseLessons(after.items, after.courseEvents, '2026-09-28', '2026-10-04').length, 1);
    store.saveLesson('a', id, { ...body, requestId: randomUUID(), revision: cancelled.requestId,
      payload: { ...body.payload, date: body.sourceDate, order: 1, teacher: payload.teacher, cancelled: false } });
    const restored = store.state('a');
    assert.equal(courseLessons(restored.items, restored.courseEvents, '2026-09-21', '2026-09-27').length, 1);
    assert.equal(restored.courseEvents.length, 3);
    db.prepare("DELETE FROM users WHERE id='a'").run();
    assert.equal(db.prepare('SELECT count(*) n FROM course_events').get().n, 0);
  } finally { db.close(); }
});
test('course photos reject invalid and other-owner attachments on both recurring and single lessons', () => {
  const { db, store, id, payload } = fixture();
  try {
    const photo = randomUUID();
    db.prepare('INSERT INTO task_photos VALUES(?,?,?,?,?)').run(photo, 'b', 'fixture', 'hash', new Date().toISOString());
    assert.throws(() => store.save('a', { revision: 0, payload: { ...payload, photos: [photo] } }, id));
    assert.throws(() => store.save('a', { revision: 0, payload: { ...payload, photos: ['data:image/png;base64,xx'] } }, id));
    const body = { requestId: randomUUID(), sourceDate: '2026-09-21', payload: { date: '2026-09-21', order: 1, teacher: '', room: '', cancelled: false, photos: [photo] } };
    assert.throws(() => store.saveLesson('a', id, body));
    db.prepare("UPDATE task_photos SET user_id='a' WHERE id=?").run(photo);
    store.saveLesson('a', id, body);
    assert.deepEqual(store.state('a').courseEvents[0].payload.photos, [photo]);
  } finally { db.close(); }
});
test('conflicts compare teacher, class and room; reminders use adjusted lessons, Shanghai time and configured teacher', () => {
  const { db, store } = fixture();
  try {
    let state = store.state('a');
    let lessons = courseLessons(state.items, [], '2026-09-21', '2026-09-21');
    const original = lessons[0];
    assert.deepEqual(courseConflicts([original, { ...original, key: 'other' }])[0].reasons, ['老师', '班级', '教室']);
    assert.equal(courseConflicts([original, { ...original, order: 2 }]).length, 0);
    assert.equal(courseReminders(state, Date.parse('2026-09-21T07:00:00+08:00'), 0).length, 0);
    store.saveCourseSettings('a', { ...defaultCourseSettings(), myTeacher: '李老师', confirmed: true, reminders: true });
    state = store.state('a');
    const reminders = courseReminders(state, Date.parse('2026-09-21T07:00:00+08:00'), 0);
    assert.equal(reminders.length, 1);
    assert.equal(new Date(reminders[0].at).toISOString(), '2026-09-20T23:50:00.000Z');
    assert.equal(lessonTime(original, state.courseSettings).end, Date.parse('2026-09-21T08:40:00+08:00'));
    assert.equal(courseReminders({ ...state, courseSettings: { ...state.courseSettings, myTeacher: '其他老师' } }, Date.parse('2026-09-21T07:00:00+08:00'), 0).length, 0);
  } finally { db.close(); }
});
test('substitution and cancellation suppress the original teacher reminder, while moves get the new date', () => {
  const { db, store, id } = fixture();
  try {
    store.saveCourseSettings('a', { ...defaultCourseSettings(), myTeacher: '李老师', confirmed: true, reminders: true });
    const now = Date.parse('2026-09-21T07:00:00+08:00');
    const body = { requestId: randomUUID(), sourceDate: '2026-09-21', payload: {
      date: '2026-09-22', order: 2, teacher: '王老师', room: '', cancelled: false, photos: [],
    } };
    store.saveLesson('a', id, body);
    assert.equal(courseReminders(store.state('a'), now, 2).length, 0);
    store.saveCourseSettings('a', { ...store.state('a').courseSettings, myTeacher: '王老师' });
    const moved = courseReminders(store.state('a'), now, 2);
    assert.equal(moved.length, 1);
    assert.equal(moved[0].at, Date.parse('2026-09-22T08:40:00+08:00'));
    store.saveLesson('a', id, { ...body, requestId: randomUUID(), revision: body.requestId, payload: { ...body.payload, cancelled: true } });
    assert.equal(courseReminders(store.state('a'), now, 2).length, 0);
  } finally { db.close(); }
});
