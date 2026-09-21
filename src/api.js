import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { habitReminders } from '../shared/planner.mjs';
import { withReminderChannel } from './reminder-notifications.mjs';
import { taskReminderOccurrences } from '../shared/task-reminders.mjs';
import { courseReminders } from '../shared/courses.mjs';

export const isNative = Capacitor.isNativePlatform();
export function getBase() {
  if (window.__ZAIZAI_OVERLAY__) return window.__ZAIZAI_OVERLAY__.base;
  return (localStorage.getItem('zaizai-server') || (isNative ? import.meta.env.VITE_NATIVE_API_URL || '' : '')).replace(/\/$/, '');
}
export function getToken() {
  return window.__ZAIZAI_OVERLAY__?.token || localStorage.getItem('zaizai-token');
}
export async function request(path, options = {}) {
  const response = await fetch(`${getBase()}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '请求失败'), { status: response.status });
  return result;
}
const DocumentExport = registerPlugin('DocumentExport');
export async function exportLedger(filters) {
  const response = await fetch(`${getBase()}/api/ledger/export?${new URLSearchParams(filters)}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('zaizai-token')}` },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '导出失败');
  }
  const csv = await response.text();
  const filename = `zaizai-ledger-${filters.month || 'all'}.csv`;
  if (isNative) {
    const result = await DocumentExport.save({ filename, text: csv });
    return !result.cancelled;
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv.replace(/^\uFEFF/, '')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
export function notificationId(id) {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % 2147483646 + 1;
}
let reminderQueue = Promise.resolve();
export function syncReminders(records, ask = false) {
  const next = reminderQueue.catch(() => {}).then(() => scheduleReminders(records, ask));
  reminderQueue = next;
  return next;
}
async function scheduleReminders(records, ask) {
  if (!isNative) {
    if (ask) {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      throw new Error('提醒已保存；网页版仅在应用打开时提醒，关闭后的系统提醒需使用安卓安装包');
    }
    return;
  }
  const permission = ask ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') {
    if (ask) throw new Error('通知权限未开启，待办已保存，但不能在系统中提醒');
    return;
  }
  const planner = getToken() ? await request('/planner') : { items: [], checks: [] };
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
  const now = Date.now();
  const upcoming = records.flatMap(record => taskReminderOccurrences(record, now + 1,
    record.payload.reminderRepeat && record.payload.reminderRepeat !== 'once' ? now + 30 * 86400000 : Math.max(now, Date.parse(record.payload.due) || now))
    .map(at => ({ record, at })));
  const habits = habitReminders(planner.items, planner.checks).slice(0, 256).map(item => ({
    id: notificationId(`habit:${item.key}`), title: '在在 · 打卡提醒', body: item.title,
    schedule: { at: new Date(item.at), allowWhileIdle: true },
    extra: { habitId: item.habitId }, smallIcon: 'ic_stat_notify',
  }));
  const courses = courseReminders(planner).slice(0, 256).map(item => ({
    id: notificationId(item.key), title: '在在 · 课前提醒', body: item.title,
    schedule: { at: new Date(item.at), allowWhileIdle: true },
    extra: { courseId: item.courseId }, smallIcon: 'ic_stat_notify',
  }));
  if (upcoming.length || habits.length || courses.length) {
    await LocalNotifications.schedule({
      notifications: withReminderChannel([...upcoming.map(({ record, at }) => ({
        id: notificationId(`${record.id}:${at}`), title: '在在 · 到时间了', body: record.payload.title,
        schedule: { at: new Date(at), allowWhileIdle: true },
        extra: { recordId: record.id }, smallIcon: 'ic_stat_notify',
      })), ...habits, ...courses]),
    });
  }
}
