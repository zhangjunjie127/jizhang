const DAY = 86400000;
const OFFSET = 8 * 3600000;
export function taskReminderOccurrences(record, from, to) {
  const { due, reminderRepeat = 'once', reminderDays } = record.payload;
  const start = Date.parse(due);
  if (record.kind !== 'task' || record.status !== 'confirmed' || record.completed || record.deleted_at || !Number.isFinite(start)) return [];
  if (reminderRepeat === 'once') return start >= from && start <= to ? [start] : [];
  if (!['weekly', 'monthly'].includes(reminderRepeat)) return [];
  const anchor = new Date(start + OFFSET);
  const days = reminderDays || [reminderRepeat === 'weekly' ? anchor.getUTCDay() : anchor.getUTCDate()];
  const clock = (start + OFFSET) % DAY;
  const result = [];
  for (let day = Math.floor((Math.max(from, start) + OFFSET) / DAY) * DAY; day <= to + OFFSET; day += DAY) {
    const date = new Date(day);
    const matches = days.includes(reminderRepeat === 'weekly' ? date.getUTCDay() : date.getUTCDate());
    const at = day + clock - OFFSET;
    if (matches && at >= from && at >= start && at <= to) result.push(at);
  }
  return result;
}

export function taskReminderLabel(payload) {
  if (!payload.due || !['weekly', 'monthly'].includes(payload.reminderRepeat)) return '';
  const anchor = new Date(Date.parse(payload.due) + OFFSET);
  const weekly = payload.reminderRepeat === 'weekly';
  const days = payload.reminderDays || [weekly ? anchor.getUTCDay() : anchor.getUTCDate()];
  const labels = weekly ? [1, 2, 3, 4, 5, 6, 0].filter(day => days.includes(day)).map(day => `周${'日一二三四五六'[day]}`)
    : [...days].sort((a, b) => a - b).map(day => `${day}日`);
  return `${weekly ? '每' : '每月'}${labels.join('、')} ${anchor.toISOString().slice(11, 16)}`;
}
