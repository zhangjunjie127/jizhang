import { useEffect, useRef } from 'react';
import { request, isNative } from './api';
import { habitReminders } from '../shared/planner.mjs';
import { taskReminderOccurrences } from '../shared/task-reminders.mjs';
import { courseReminders } from '../shared/courses.mjs';

export function HabitReminders({ userId, records = [], onNotify }) {
  const notify = useRef(onNotify);
  notify.current = onNotify;
  const tasks = useRef(records);
  tasks.current = records;
  useEffect(() => {
    if (isNative) return;
    let active = true, loading = false;
    const key = `zaizai-habit-reminders-${userId}`;
    let seen;
    try { seen = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { seen = new Set(); }
    async function poll() {
      if (loading) return;
      loading = true;
      try {
        const state = await request('/planner');
        if (!active) return;
        const now = Date.now();
        const taskDue = tasks.current.flatMap(record => taskReminderOccurrences(record, now - 60000, now)
          .map(at => ({ key: `task:${record.id}:${at}`, title: record.payload.title, at, task: true })));
        const due = [...habitReminders(state.items, state.checks, now - 60000, 2), ...taskDue, ...courseReminders(state, now - 60000, 2)]
          .filter(item => item.at <= now && !seen.has(item.key));
        for (const item of due) {
          seen.add(item.key);
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(item.courseId ? '在在 · 课前提醒' : item.task ? '在在 · 待办提醒' : '在在 · 打卡提醒', { body: item.title, tag: item.key }); } catch {}
          }
        }
        if (due.length) {
          localStorage.setItem(key, JSON.stringify([...seen].slice(-256)));
          notify.current(`提醒：${due.map(item => item.title).join('、')}`);
        }
      } catch {} finally { loading = false; }
    }
    void poll();
    const timer = setInterval(poll, 20000);
    window.addEventListener('planner-changed', poll);
    return () => { active = false; clearInterval(timer); window.removeEventListener('planner-changed', poll); };
  }, [userId]);
  return null;
}
