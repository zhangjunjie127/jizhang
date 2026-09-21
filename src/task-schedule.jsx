import { DateInput } from './date-picker';
import React, { useState } from 'react';
import { plannerToday } from '../shared/planner.mjs';
import { taskReminderLabel } from '../shared/task-reminders.mjs';

export function TaskSchedule({ initial, payload }) {
  const [repeat, setRepeat] = useState(payload.reminderRepeat || 'once');
  const [due, setDue] = useState(() => payload.due
    ? new Date(Date.parse(payload.due) + 8 * 3600000).toISOString().slice(0, 16) : '');
  const anchorDate = due.slice(0, 10) || plannerToday();
  const [time, setTime] = useState(due.slice(11));
  const [weekdays, setWeekdays] = useState(() => payload.reminderRepeat === 'weekly'
    ? payload.reminderDays || [new Date(anchorDate).getUTCDay()] : []);
  const [monthDays, setMonthDays] = useState(() => payload.reminderRepeat === 'monthly'
    ? payload.reminderDays || [Number(anchorDate.slice(8))] : []);
  const days = repeat === 'weekly' ? weekdays : monthDays;
  const recurringDue = time ? `${anchorDate}T${time}` : '';
  function toggle(day) {
    const setDays = repeat === 'weekly' ? setWeekdays : setMonthDays;
    setDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day].sort((a, b) => a - b));
  }
  return <section className="task-schedule">
    <h3>记录溯源</h3>
    <label>创建时间<output>{initial?.created ? new Date(initial.created).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '待保存'}</output></label>
    <label>事项发生日期<DateInput name="occurredDate" type="date" defaultValue={payload.occurredDate || ''} /></label>
    <h3>安排与提醒</h3>
    <label>安排日期<DateInput name="scheduledDate" type="date" defaultValue={payload.scheduledDate || ''} /></label>
    <div className="task-reminder-modes" role="group" aria-label="提醒频率">
      {[['once', '单次'], ['weekly', '每周'], ['monthly', '每月']].map(([value, text]) =>
        <button key={value} type="button" aria-pressed={repeat === value} onClick={() => setRepeat(value)}>{text}</button>)}
    </div>
    <input type="hidden" name="reminderRepeat" value={repeat} />
    {repeat === 'once' ? <label>提醒时间<DateInput name="due" type="datetime-local" value={due}
      onChange={event => { setDue(event.target.value); setTime(event.target.value.slice(11)); }} /></label> : <>
      <fieldset className="task-repeat-days"><legend>{repeat === 'weekly' ? '提醒星期（可多选）' : '提醒日期（可多选）'}</legend>
        <div className="task-repeat-day-grid">{(repeat === 'weekly' ? [1, 2, 3, 4, 5, 6, 0] : Array.from({ length: 31 }, (_, i) => i + 1)).map(day =>
          <button type="button" key={day} aria-pressed={days.includes(day)} aria-label={repeat === 'weekly' ? `周${'日一二三四五六'[day]}` : `每月${day}日`}
            onClick={() => toggle(day)}>{repeat === 'weekly' ? `周${'日一二三四五六'[day]}` : day}</button>)}</div>
      </fieldset>
      <input type="hidden" name="reminderDays" value={JSON.stringify(days)} />
      <input type="hidden" name="due" value={recurringDue} />
      <label>提醒时间<DateInput type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
      {days.length > 0 && time && <p className="task-repeat-summary">{taskReminderLabel({
        due: `${recurringDue}:00+08:00`, reminderRepeat: repeat, reminderDays: days,
      })}{repeat === 'monthly' && days.some(day => day > 28) ? ' · 无此日期的月份跳过' : ''}</p>}
    </>}
  </section>;
}
