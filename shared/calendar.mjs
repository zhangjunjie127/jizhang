import calendar from 'lunar-javascript';
import { taskPriority, taskPriorityRank } from './task-priorities.mjs';

export function calendarCorner(tasks, hasAnniversary = false) {
  if (!tasks.length) return hasAnniversary
    ? { kind: 'anniversary', color: '#bda35d', label: '纪念日' }
    : { kind: 'empty', color: '#e9edf1', label: '暂无待办或纪念日' };
  const highest = tasks.reduce((best, task) => taskPriorityRank(task.payload.priority) < taskPriorityRank(best.payload.priority) ? task : best);
  const priority = taskPriority(highest.payload.priority);
  return { kind: priority.value, color: priority.color, label: priority.label };
}

const { Solar, SolarWeek, HolidayUtil } = calendar;
export const calendarClock = (now = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(now);
export function calendarDayEntries(tasks, anniversaries = []) {
  const entries = [
    ...tasks.map(item => ({ item, time: Number.isFinite(Date.parse(item.payload.due)) ? calendarClock(new Date(item.payload.due)) : '' })),
    ...anniversaries.map(item => ({ item, anniversary: true, time: '' })),
  ];
  return entries.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}
export function calendarAlmanac(date, clock = calendarClock()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01' || date > '2101-12-31' ||
    !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('历法日期或时间无效');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0), lunar = solar.getLunar();
  return {
    lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    constellation: `${solar.getXingZuo()}座`, zodiac: lunar.getYearShengXiao(),
    year: lunar.getYearInGanZhi(), month: lunar.getMonthInGanZhi(), day: lunar.getDayInGanZhi(),
    time: lunar.getTimeInGanZhi(), week: SolarWeek.fromYmd(year, month, day, 1).getIndexInYear(),
    weekday: `星期${solar.getWeekInChinese()}`, yi: lunar.getDayYi(), ji: lunar.getDayJi(),
  };
}
export function validCalendarDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= '1901-01-01' && date <= '2100-12-31' &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function calendarInfo(date) {
  const solar = Solar.fromYmd(...date.split('-').map(Number));
  const lunar = solar.getLunar();
  const primaryFestivals = [...solar.getFestivals(), ...lunar.getFestivals()];
  const festivals = [...new Set([...primaryFestivals,
    ...solar.getOtherFestivals(), ...lunar.getOtherFestivals()])];
  const term = lunar.getJieQi();
  const holiday = HolidayUtil.getHoliday(date);
  return {
    lunarYear: lunar.getYear(), lunarMonth: lunar.getMonth(), lunarDay: lunar.getDay(),
    lunarLabel: lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese(),
    lunarFull: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    festivals, term, label: primaryFestivals[0] || term || (lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese()),
    highlighted: primaryFestivals.length > 0,
    // Only mark days explicitly present in the library's published holiday dataset.
    holiday: holiday ? { name: holiday.getName(), work: holiday.isWork() } : null,
  };
}
export function anniversaryOccurs(payload, date, info = calendarInfo(date), originalInfo) {
  if (date < payload.date) return false;
  if (payload.repeat === 'once') return date === payload.date;
  if (payload.calendar === 'solar') return date.slice(5) === payload.date.slice(5);
  const original = originalInfo || calendarInfo(payload.date);
  return original.lunarMonth === info.lunarMonth && original.lunarDay === info.lunarDay;
}
