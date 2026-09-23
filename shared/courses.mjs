import { plannerToday, shiftDate, weekday } from './planner.mjs';

export function courseTone(title) {
  const subjects = [['语文', 'rose'], ['数学', 'blue'], ['英语', 'violet'], ['科学', 'teal'],
    ['体育', 'green'], ['美术', 'amber'], ['音乐', 'violet'], ['劳动', 'green']];
  const normalized = String(title || '').trim().replace(/\s+/g, '');
  const subjectTone = subjects.find(([subject]) => normalized.includes(subject))?.[1];
  if (subjectTone) return subjectTone;
  const tones = ['blue', 'green', 'violet', 'rose', 'amber', 'teal'];
  const hash = [...normalized].reduce((value, char) => (value * 31 + char.codePointAt(0)) >>> 0, 7);
  return tones[hash % tones.length];
}

export function defaultCourseSettings() {
  return { revision: 0, myTeacher: '', confirmed: false, reminders: false, leadMinutes: 10,
    bells: [['08:00', '08:40'], ['08:50', '09:30'], ['09:50', '10:30'], ['10:40', '11:20'],
      ['14:00', '14:40'], ['14:50', '15:30'], ['15:40', '16:20']].map(([start, end]) => ({ start, end })) };
}

export function courseLessons(items, events = [], from, to) {
  const result = [];
  const eventsByCourse = new Map();
  for (const event of events) {
    let overrides = eventsByCourse.get(event.course_id);
    if (!overrides) eventsByCourse.set(event.course_id, overrides = new Map());
    overrides.set(event.source_date, event);
  }
  for (const course of items) {
    if (course.kind !== 'course' || course.deleted_at) continue;
    const overrides = eventsByCourse.get(course.id) || new Map();
    const dates = new Set(overrides.keys());
    for (let date = from; date <= to; date = shiftDate(date, 1)) {
      if (course.payload.weekdays.includes(weekday(date))) dates.add(date);
    }
    for (const sourceDate of dates) {
      const event = overrides.get(sourceDate);
      const payload = { ...course.payload, ...event?.payload };
      const date = payload.date || sourceDate;
      if (date < from || date > to || payload.cancelled) continue;
      result.push({ ...payload, date, sourceDate, course, event,
        key: `${course.id}:${sourceDate}`, changed: Boolean(event) });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key));
}

export function courseSubstitutions(items, events = []) {
  const courses = new Map(items.filter(item => item.kind === 'course' && !item.deleted_at).map(item => [item.id, item]));
  const latest = new Map();
  for (const event of events) latest.set(`${event.course_id}:${event.source_date}`, event);
  return [...latest.values()].filter(event => {
    const course = courses.get(event.course_id);
    const teacher = event.payload.teacher?.trim();
    const original = course?.payload.teacher?.trim();
    return course && original && teacher && teacher !== original && !event.payload.cancelled;
  });
}

export function courseConflicts(lessons) {
  const conflicts = [];
  for (let i = 0; i < lessons.length; i++) for (let j = i + 1; j < lessons.length; j++) {
    const a = lessons[i], b = lessons[j];
    if (a.date !== b.date || a.order !== b.order) continue;
    const reasons = [['teacher', '老师'], ['className', '班级'], ['room', '教室']]
      .filter(([key]) => a[key] && a[key] === b[key]).map(([, label]) => label);
    if (reasons.length) conflicts.push({ a, b, reasons });
  }
  return conflicts;
}

export function lessonTime(lesson, settings) {
  const bell = settings?.confirmed && settings.bells[lesson.order - 1];
  return bell ? { start: Date.parse(`${lesson.date}T${bell.start}:00+08:00`),
    end: Date.parse(`${lesson.date}T${bell.end}:00+08:00`) } : null;
}

export function courseReminders(state, now = Date.now(), days = 30) {
  const settings = state.courseSettings;
  if (!settings?.confirmed || !settings.reminders || !settings.myTeacher) return [];
  const today = plannerToday(now);
  return courseLessons(state.items, state.courseEvents, today, shiftDate(today, days))
    .filter(lesson => lesson.teacher === settings.myTeacher)
    .flatMap(lesson => {
      const time = lessonTime(lesson, settings);
      if (!time) return [];
      const at = time.start - settings.leadMinutes * 60000;
      return at >= now ? [{ key: `course:${lesson.key}:${at}`, courseId: lesson.course.id, at,
        title: [lesson.title, lesson.className, lesson.room, `第${lesson.order}节`].filter(Boolean).join(' · ') }] : [];
    });
}
