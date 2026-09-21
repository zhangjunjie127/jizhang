import { calendarInfo } from './calendar.mjs';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const PLANNER_TONES = ['blue', 'green', 'violet', 'rose', 'amber', 'teal'];
export const HABIT_ICONS = ['book', 'exercise', 'water', 'sun', 'study', 'heart', 'moon', 'apple', 'breakfast', 'smoke', 'wine', 'scale', 'snack', 'pill', 'pen', 'smile', 'walk', 'target'];
export const HABIT_REPEATS = [['weekly', '周定期'], ['week-flex', '周弹性'], ['monthly', '月定期'], ['month-flex', '月弹性']];
const HABIT_APPEARANCES = [
  [/喝水|饮水|补水/, 'water', 'blue'], [/早睡|睡觉|睡眠|晚安/, 'moon', 'violet'],
  [/早起|起床/, 'sun', 'amber'], [/水果/, 'apple', 'rose'], [/早餐|早饭/, 'breakfast', 'amber'],
  [/戒烟|吸烟/, 'smoke', 'teal'], [/戒酒|饮酒/, 'wine', 'rose'], [/体重|减重|减肥/, 'scale', 'green'],
  [/零食|控糖|少糖/, 'snack', 'violet'], [/吃药|服药|用药/, 'pill', 'blue'],
  [/感恩|日记|写作|写字/, 'pen', 'teal'], [/阅读|读书|看书/, 'book', 'blue'],
  [/单词|学习|复习|背诵|英语|课程/, 'study', 'violet'], [/跑步|慢跑/, 'walk', 'blue'],
  [/散步|走路|步行/, 'walk', 'teal'], [/运动|健身|拉伸|瑜伽|锻炼|游泳|骑行/, 'exercise', 'green'],
  [/心情|冥想|开心/, 'smile', 'amber'], [/家人|父母|陪伴|联系|健康/, 'heart', 'rose'],
];
export function habitAppearance(title) {
  const match = HABIT_APPEARANCES.find(([pattern]) => pattern.test(title));
  return { icon: match?.[1] || 'target', tone: match?.[2] || 'blue' };
}
export const plannerToday = (now = new Date()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
export const weekday = date => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function monthDays(month) {
  const first = `${month}-01`;
  return Array.from({ length: 42 }, (_, index) => shiftDate(first, index - weekday(first)));
}
export function habitScheduled(habit, date) {
  const p = habit.payload;
  if (date < (p.startDate || plannerToday(habit.created)) || (p.endDate && date > p.endDate)) return false;
  if (p.skipHolidays) {
    const holiday = calendarInfo(date).holiday;
    if (holiday && !holiday.work) return false;
  }
  if (p.repeat === 'monthly') return (p.monthDays || []).includes(Number(date.slice(8)));
  if (p.repeat === 'week-flex' || p.repeat === 'month-flex') return true;
  return p.weekdays.includes(weekday(date));
}
export function habitPeriod(habit, date) {
  if (habit.payload.repeat === 'month-flex') {
    const start = `${date.slice(0, 7)}-01`;
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return [start, shiftDate(next.toISOString().slice(0, 10), -1)];
  }
  const start = shiftDate(date, -weekday(date));
  return [start, shiftDate(start, 6)];
}
export function habitProgress(habit, dates, date) {
  const [start, end] = habitPeriod(habit, date);
  return [...dates].filter(value => value >= start && value <= end).length;
}
export function habitDue(habit, dates, date) {
  return habitScheduled(habit, date) && !dates.has(date) &&
    (!['week-flex', 'month-flex'].includes(habit.payload.repeat) || habitProgress(habit, dates, date) < habit.payload.targetCount);
}
export function habitRepeatLabel(p) {
  if (p.repeat === 'week-flex') return `每周 ${p.targetCount} 次`;
  if (p.repeat === 'month-flex') return `每月 ${p.targetCount} 次`;
  if (p.repeat === 'monthly') return `每月 ${p.monthDays.join('、')} 日`;
  return p.weekdays.length === 7 ? '每天' : p.weekdays.map(day => WEEKDAYS[day]).join('、');
}
export const checkedDates = (checks, id) => new Set(checks.filter(check => check.item_id === id).map(check => check.date));
export function habitStreak(habit, dates, today = plannerToday()) {
  if (['week-flex', 'month-flex'].includes(habit.payload.repeat)) {
    let count = 0, date = today;
    const startDate = habit.payload.startDate || plannerToday(habit.created);
    while (date >= startDate) {
      const [start] = habitPeriod(habit, date);
      if (habitProgress(habit, dates, date) >= habit.payload.targetCount) count++;
      else if (date !== today) break;
      date = shiftDate(start, -1);
    }
    return count;
  }
  let count = 0;
  for (let date = today; date >= (habit.payload.startDate || plannerToday(habit.created)); date = shiftDate(date, -1)) {
    if (!habitScheduled(habit, date)) continue;
    if (dates.has(date)) count++;
    else if (date !== today) break;
  }
  return count;
}

export function habitReminders(items, checks, now = Date.now(), days = 30) {
  const reminders = [], today = plannerToday(now);
  for (const habit of items.filter(item => item.kind === 'habit' && item.payload.reminders?.length)) {
    const dates = checkedDates(checks, habit.id);
    for (let offset = 0; offset < days; offset++) {
      const date = shiftDate(today, offset);
      if (!habitDue(habit, dates, date)) continue;
      for (const time of habit.payload.reminders) {
        const at = Date.parse(`${date}T${time}:00+08:00`);
        if (at >= now) reminders.push({ key: `${habit.id}:${date}:${time}`, habitId: habit.id, title: habit.payload.title, at });
      }
    }
  }
  return reminders.sort((a, b) => a.at - b.at);
}
