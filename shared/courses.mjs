import { plannerToday, shiftDate, weekday } from './planner.mjs';

export function courseTone(title) {
  const subjects = [['语文', 'rose'], ['数学', 'blue'], ['英语', 'violet'], ['科学', 'teal'],
    ['体育', 'green'], ['美术', 'amber'], ['音乐', 'violet'], ['劳动', 'green']];
  return subjects.find(([subject]) => title.includes(subject))?.[1] || 'blue';
}

export function defaultCourseSettings() {
  return { revision: 0, myTeacher: '', confirmed: false, reminders: false, leadMinutes: 10,
    bells: [['08:00', '08:40'], ['08:50', '09:30'], ['09:50', '10:30'], ['10:40', '11:20'],
      ['14:00', '14:40'], ['14:50', '15:30'], ['15:40', '16:20']].map(([start, end]) => ({ start, end })) };
}

export function courseLessons(items, events = [], from, to) {
  const result = [];
  for (const course of items.filter(item => item.kind === 'course' && !item.deleted_at)) {
    const overrides = new Map();
    for (const event of events.filter(item => item.course_id === course.id)) overrides.set(event.source_date, event);
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
  return courseLessons(state.items, state.courseEvents, plannerToday(now), shiftDate(plannerToday(now), days))
    .filter(lesson => lesson.teacher === settings.myTeacher)
    .flatMap(lesson => {
      const time = lessonTime(lesson, settings);
      if (!time) return [];
      const at = time.start - settings.leadMinutes * 60000;
      return at >= now ? [{ key: `course:${lesson.key}:${at}`, courseId: lesson.course.id, at,
        title: [lesson.title, lesson.className, lesson.room, `第${lesson.order}节`].filter(Boolean).join(' · ') }] : [];
    });
}
