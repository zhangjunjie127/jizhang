import { courseLessons, lessonTime, defaultCourseSettings } from './courses.mjs';
import { plannerToday, shiftDate } from './planner.mjs';
import { taskReminderOccurrences } from './task-reminders.mjs';

export const defaultWidgetSettings = () => ({
  tasks: false, courses: false, showContent: false, taskScope: 'today', layout: 'week', source: 'both'
});

const DAY = 86400000;
const shanghaiTime = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(11, 16);
const taskColor = index => ['#ff9ab5', '#8fc8ff', '#ffd36e', '#a9dfc1'][index % 4];
const courseColor = index => ['#f8b7a6', '#b7dcff', '#c9e9bf', '#e9c9f7'][index % 4];

export function widgetSnapshot(records, planner, settings, now = Date.now()) {
  const today = plannerToday(now);
  const rangeDays = settings.taskScope === 'today' ? 1 : 31;
  const rangeEnd = shiftDate(today, rangeDays);
  const rawTasks = records.filter(r => r.kind === 'task' && r.status === 'confirmed' && !r.completed && !r.deleted_at)
    .flatMap((record, recordIndex) => {
      const payload = record.payload || {};
      const occurrences = taskReminderOccurrences(record, now, Date.parse(`${rangeEnd}T00:00:00+08:00`));
      const dates = occurrences.length ? occurrences : [payload.scheduledDate || (payload.due ? plannerToday(Date.parse(payload.due)) : '')];
      return dates.map((timestampOrDate, occurrenceIndex) => {
        const timestamp = typeof timestampOrDate === 'number' ? timestampOrDate : Date.parse(`${timestampOrDate}T00:00:00+08:00`);
        const date = typeof timestampOrDate === 'number' ? plannerToday(timestampOrDate) : timestampOrDate;
        const time = typeof timestampOrDate === 'number' ? shanghaiTime(timestampOrDate) : '';
        return { id: `${record.id}-${occurrenceIndex}`, kind: 'task', title: payload.title || '未命名待办', detail: date ? `${date}${time ? ` ${time}` : ''}` : '未安排日期',
          start: Number.isFinite(timestamp) ? timestamp : 0, end: Number.isFinite(timestamp) ? timestamp + DAY : 0,
          date, time, color: taskColor(recordIndex), sourceId: record.id };
      });
    }).filter(row => settings.taskScope !== 'today' || row.date === today);
  const courseSettings = planner.courseSettings || defaultCourseSettings();
  const courses = courseLessons(planner.items || [], planner.courseEvents || [], today, rangeEnd)
    .filter(lesson => courseSettings.myTeacher && lesson.teacher === courseSettings.myTeacher)
    .map((lesson, index) => {
      const time = lessonTime(lesson, courseSettings);
      const start = time?.start || Date.parse(`${lesson.date}T00:00:00+08:00`);
      const end = time?.end || Date.parse(`${shiftDate(lesson.date, 1)}T00:00:00+08:00`);
      return { id: lesson.id || `${lesson.date}-${lesson.order}-${index}`, kind: 'course', title: lesson.title || '未命名课程',
        detail: [lesson.date, `第${lesson.order}节`, time && courseSettings.bells[lesson.order - 1]?.start, lesson.className, lesson.room].filter(Boolean).join(' · '),
        start, end, date: lesson.date, time: time && courseSettings.bells[lesson.order - 1]?.start || '',
        color: courseColor(index), className: lesson.className || '', room: lesson.room || '' };
    }).filter(lesson => lesson.end > now);
  const tasks = rawTasks.sort((a, b) => (a.start || Infinity) - (b.start || Infinity)).slice(0, 60);
  const upcomingCourses = courses.sort((a, b) => a.start - b.start).slice(0, 60);
  const allRows = [...tasks, ...upcomingCourses].sort((a, b) => (a.start || Infinity) - (b.start || Infinity)).slice(0, 80);
  const enabledRows = settings.showContent ? allRows.filter(row => settings.source === 'both' || row.kind === (settings.source === 'tasks' ? 'task' : 'course')) : [];
  return { updated: now, expires: settings.taskScope === 'today'
    ? Math.min(now + DAY, Date.parse(`${shiftDate(today, 1)}T00:00:00+08:00`)) : now + DAY,
    layout: settings.layout || 'week', source: settings.source || 'both',
    tasks: { enabled: settings.tasks, message: settings.taskScope === 'today' ? '今日暂无待办' : '暂无未完成待办', rows: settings.showContent && settings.tasks ? tasks : [] },
    courses: { enabled: settings.courses, message: courseSettings.myTeacher ? '近期暂无课程' : '请先设置我的授课姓名', rows: settings.showContent && settings.courses ? upcomingCourses : [] },
    agenda: { enabled: settings.tasks || settings.courses, message: '暂无日程', rows: enabledRows },
    private: !settings.showContent };
}
