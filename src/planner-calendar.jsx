import { DateInput, DatePickerDialog } from './date-picker';
import React, { useMemo, useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { shiftDate, weekday, PLANNER_TONES } from '../shared/planner.mjs';
import { anniversaryOccurs, calendarInfo, validCalendarDate, calendarAlmanac, calendarCorner, calendarDayEntries } from '../shared/calendar.mjs';
import { taskCategory } from '../shared/task-categories.mjs';
import { requestId } from './navigation';

export function MonthCalendar({ month, selected, today, dayTasks, anniversaries, onSelect, onTask, onAnniversary, onDay }) {
  const capacity = 6;
  const days = useMemo(() => {
    const first = `${month}-01`, start = shiftDate(first, -(weekday(first) + 1) % 7);
    const dates = Array.from({ length: 42 }, (_, index) => shiftDate(start, index));
    const count = Math.ceil((dates.findLastIndex(date => date.slice(0, 7) === month) + 1) / 7) * 7;
    return dates.slice(0, count).map(date => ({ date, info: calendarInfo(date) }));
  }, [month]);
  const originalDates = useMemo(() => new Map(anniversaries.filter(item => item.payload.calendar === 'lunar')
    .map(item => [item.id, calendarInfo(item.payload.date)])), [anniversaries]);
  return <div className="planner-month-board">
    <div className="planner-calendar-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="planner-month-grid" data-capacity={capacity} style={{ '--week-count': days.length / 7 }}>{days.map(({ date, info }) => {
      const tasks = dayTasks.get(date) || [];
      const personal = anniversaries.filter(item => anniversaryOccurs(item.payload, date, info, originalDates.get(item.id)));
      const corner = calendarCorner(tasks, personal.length > 0);
      const entries = calendarDayEntries(tasks, personal);
      return <section key={date} className={`planner-month-cell ${date.slice(0, 7) !== month ? 'outside' : ''} ${info.highlighted || (info.holiday && !info.holiday.work) ? 'holiday' : ''} ${date === selected ? 'selected' : ''} ${date === today ? 'is-today' : ''}`} data-date={date}>
        <button className="planner-cell-date" aria-label={`${date}，${info.lunarFull}，${[...info.festivals, info.term].filter(Boolean).join('、')}，${tasks.length}项日程，${personal.length}项纪念日`} aria-pressed={date === selected} onClick={() => onSelect(date)}>
          <span className="planner-day-number" aria-current={date === today ? 'date' : undefined}>{Number(date.slice(8))}</span>
          <span className={`planner-lunar-label ${info.highlighted ? 'festival' : ''}`} title={[...info.festivals, info.term].filter(Boolean).join('、') || info.lunarFull}>{info.label}</span>
          {info.holiday && <span className={`planner-holiday-badge ${info.holiday.work ? 'work' : ''}`} title={info.holiday.name} aria-label={`${info.holiday.name}${info.holiday.work ? '调休上班' : '放假'}`}>{info.holiday.work ? '班' : '休'}</span>}
        </button>
        <div className="planner-cell-events">{entries.slice(0, capacity).map(({ item, anniversary, time }) => <button key={item.id}
          className={`planner-calendar-event ${anniversary ? `planner-tone-${item.payload.tone}` : ''} ${item.completed ? 'completed' : ''}`}
          style={anniversary ? undefined : { '--tone': taskCategory(item.payload.category).color, '--tone-soft': `${taskCategory(item.payload.category).color}18` }}
          title={[time, item.payload.title].filter(Boolean).join(' ')} aria-label={`${anniversary ? '编辑纪念日' : '编辑'}${item.payload.title}`}
          onClick={() => anniversary ? onAnniversary(item) : onTask(item)}>{time && <time dateTime={item.payload.due}>{time}</time>}<span>{item.payload.title}</span></button>)}</div>
        <div className="planner-cell-footer">
          {entries.length > 0 && <span className="planner-cell-count" aria-label={`当天共${entries.length}项待办和纪念日`}>{entries.length}项</span>}
          <button className="planner-cell-more" data-priority={corner.kind} style={{ '--corner-color': corner.color }}
            aria-label={`查看${date}详情`} aria-description={corner.label} title={`预览当天 · ${corner.label}`}
            aria-haspopup="dialog" onClick={() => onDay(date, info, personal)} />
        </div>
      </section>;
    })}</div>
  </div>;
}

export function CalendarMonthPicker({ month, onClose, onChange }) {
  return <DatePickerDialog type="month" value={month} min="1901-01" max="2100-12" required onClose={onClose} onChange={onChange} />;
}

export function DayAlmanac({ date, info }) {
  const detail = useMemo(() => calendarAlmanac(date), [date]);
  return <section className="planner-almanac" aria-label="当日历法">
    <div className="planner-almanac-heading"><h2>{detail.lunarDate}</h2><span>第{detail.week}周 · {detail.weekday}</span></div>
    <p className="planner-day-festivals">{[...info.festivals, info.term, info.holiday ? `${info.holiday.name} · ${info.holiday.work ? '调休上班' : '放假'}` : ''].filter(Boolean).join(' · ')}</p>
    <div className="planner-almanac-meta"><span>{detail.constellation}</span><span>{detail.year}年</span><span>{detail.month}月</span><span>{detail.day}日</span><span>{detail.time}时</span><span>属{detail.zodiac}</span></div>
    <div className="planner-almanac-fortune" aria-label="黄历宜忌"><div><span className="yi">宜</span><p>{detail.yi.join(' · ') || '无'}</p></div><div><span className="ji">忌</span><p>{detail.ji.join(' · ') || '无'}</p></div></div>
  </section>;
}

export function AnniversaryEditor({ Modal, entry, date, onClose, onSave, onDelete }) {
  const p = entry?.payload;
  const [selectedDate, setSelectedDate] = useState(p?.date || date);
  const [calendar, setCalendar] = useState(p?.calendar || 'solar');
  const [tone, setTone] = useState(p?.tone || 'rose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(requestId());
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), date: selectedDate, calendar, tone };
    setBusy(true); setError('');
    try { await onSave({ kind: 'anniversary', payload, requestId: key.current, revision: entry?.revision }, entry?.id); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal fullScreen className="planner-editor" title={`${entry ? '编辑' : '添加'}纪念日`} onClose={busy ? () => {} : onClose}>
    <form className="record-form" onSubmit={submit}>
      <label>纪念日名称<input name="title" required maxLength={80} defaultValue={p?.title || ''} autoFocus /></label>
      <label>原始日期（公历）<DateInput type="date" name="date" min="1901-01-01" max="2100-12-31" required value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
      <label>重复历法<select value={calendar} onChange={event => setCalendar(event.target.value)}><option value="solar">公历</option><option value="lunar">农历</option></select></label>
      {validCalendarDate(selectedDate) && <p className="planner-anniversary-lunar">{calendarInfo(selectedDate).lunarFull}</p>}
      <label>重复<select name="repeat" defaultValue={p?.repeat || 'yearly'}><option value="yearly">每年</option><option value="once">不重复</option></select></label>
      <fieldset><legend>颜色</legend><div className="planner-colors">{PLANNER_TONES.map((value, index) => <button key={value} type="button" className={`planner-tone-${value}`} aria-label={['蓝色', '绿色', '紫色', '粉色', '黄色', '青色'][index]} aria-pressed={tone === value} onClick={() => setTone(value)}>{tone === value && <Check size={18} />}</button>)}</div></fieldset>
      <label>备注<textarea name="note" rows={3} maxLength={500} defaultValue={p?.note || ''} /></label>
      {error && <p className="error-box" role="alert">{error}</p>}
      {entry && <button type="button" className="planner-delete-button" disabled={busy} onClick={onDelete}><Trash2 size={16} />删除纪念日</button>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </Modal>;
}
