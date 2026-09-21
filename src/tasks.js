import { taskCategory } from '../shared/task-categories.mjs';
import { taskPriorityRank } from '../shared/task-priorities.mjs';
const dayInShanghai = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
export const taskDate = record => record.payload.scheduledDate || (record.payload.due && Number.isFinite(Date.parse(record.payload.due)) ? dayInShanghai(record.payload.due) : '');

export const TASK_PERIODS = [['all', '全部日期'], ['today', '今天'], ['yesterday', '昨天'], ['this-week', '本周'], ['last-week', '上周'], ['this-month', '本月'], ['last-month', '上月']];

export function filterTasks(records, period = 'all', category = '', now = new Date()) {
  const today = new Date(`${dayInShanghai(now)}T00:00:00Z`);
  const day = 86400000;
  const monday = +today - (today.getUTCDay() + 6) % 7 * day;
  const year = today.getUTCFullYear(), month = today.getUTCMonth();
  const ranges = {
    today: [+today, +today + day], yesterday: [+today - day, +today],
    'this-week': [monday, monday + 7 * day], 'last-week': [monday - 7 * day, monday],
    'this-month': [Date.UTC(year, month, 1), Date.UTC(year, month + 1, 1)],
    'last-month': [Date.UTC(year, month - 1, 1), Date.UTC(year, month, 1)],
  };
  const range = ranges[period]?.map(value => new Date(value).toISOString().slice(0, 10));
  return records.filter(record => {
    if (record.kind !== 'task' || record.status !== 'confirmed' || record.deleted_at) return false;
    if (category && taskCategory(record.payload.category).label !== category) return false;
    if (!range) return true;
    const date = taskDate(record);
    if (!date) return false;
    return date >= range[0] && date < range[1];
  });
}

export function groupTasks(records, completed, now = new Date()) {
  const today = dayInShanghai(now);
  const tomorrow = dayInShanghai(new Date(now).getTime() + 86400000);
  const groups = new Map();
  const tasks = records.filter(record => record.kind === 'task' && record.status === 'confirmed'
    && !record.deleted_at && Boolean(record.completed) === completed);
  const dueTime = record => Number.isFinite(Date.parse(record.payload.due)) ? Date.parse(record.payload.due) : Infinity;
  tasks.sort((a, b) => dueTime(a) - dueTime(b));
  for (const record of tasks) {
    const date = taskDate(record);
    if (!groups.has(date)) {
      const label = !date ? '未安排日期' : date === today ? '今天' : date === tomorrow ? '明天'
        : `${date.slice(0, 4) === today.slice(0, 4) ? '' : `${date.slice(0, 4)}年`}${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
      groups.set(date, { date, label, records: [] });
    }
    groups.get(date).records.push(record);
  }
  return [...groups.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).map(group => ({
    ...group, records: group.records.sort((a, b) => taskPriorityRank(a.payload.priority) - taskPriorityRank(b.payload.priority) || dueTime(a) - dueTime(b)),
  }));
}
