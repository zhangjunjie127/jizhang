import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Dumbbell, Droplets, Sunrise, GraduationCap, Heart, Moon, Apple, Soup, CigaretteOff, WineOff, Scale, CandyOff, Pill, PenLine, Smile, Footprints, Target, Check, X, ChevronRight, Plus, Trash2, Pause, Play, Square, Timer, Bell } from 'lucide-react';
import { habitAppearance, HABIT_REPEATS, WEEKDAYS, plannerToday, shiftDate, checkedDates, habitScheduled, habitRepeatLabel, habitProgress } from '../shared/planner.mjs';
import { requestId } from './navigation';
import { HABIT_TEMPLATES as templates, HABIT_TEMPLATE_CATEGORIES, habitTemplateFields } from '../shared/habit-templates.mjs';
import './habits.css';

const icons = { book: BookOpen, exercise: Dumbbell, water: Droplets, sun: Sunrise, study: GraduationCap, heart: Heart,
  moon: Moon, apple: Apple, breakfast: Soup, smoke: CigaretteOff, wine: WineOff, scale: Scale, snack: CandyOff,
  pill: Pill, pen: PenLine, smile: Smile, walk: Footprints, target: Target };

export function HabitIcon({ icon, size = 22 }) {
  const Icon = icons[icon] || Target;
  return <Icon size={size} aria-hidden="true" />;
}

function Choices({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return createPortal(<dialog className="habit-choices" ref={ref} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header><h2>{title}</h2><button type="button" className="planner-icon" aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header>
    {children}
  </dialog>, document.body);
}

export function HabitEditor({ Modal, entry, onClose, onSave, onDelete }) {
  const old = entry?.payload;
  const [value, setValue] = useState(() => ({
    title: '', icon: 'target', tone: 'blue', weekdays: [0, 1, 2, 3, 4, 5, 6], repeat: 'weekly',
    monthDays: [Number(plannerToday().slice(8))], targetCount: 3, skipHolidays: false, focus: false,
    focusMinutes: 25, endDate: '',
    reminders: [], note: '', ...old, startDate: old?.startDate || (entry ? plannerToday(entry.created) : plannerToday()),
  }));
  const [remind, setRemind] = useState(Boolean(old?.reminders?.length));
  const [picker, setPicker] = useState('');
  const [category, setCategory] = useState('推荐');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(requestId());
  const update = patch => setValue(previous => ({ ...previous, ...patch }));
  const toggleDay = (key, day) => update({ [key]: value[key].includes(day) ? value[key].filter(item => item !== day) : [...value[key], day].sort((a, b) => a - b) });
  function applyTemplate(template) {
    update(habitTemplateFields(template));
    setRemind(Boolean(template.time)); setPicker(''); setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (value.repeat === 'weekly' && !value.weekdays.length) { setError('请至少选择一个星期'); return; }
    if (value.repeat === 'monthly' && !value.monthDays.length) { setError('请至少选择一个日期'); return; }
    if (remind && (!value.reminders.length || value.reminders.some(time => !time))) { setError('请设置提醒时间'); return; }
    setBusy(true); setError('');
    const template = templates.find(item => item.title === value.title.trim());
    const appearance = old && value.title.trim() === old.title.trim()
      ? { icon: old.icon, tone: old.tone }
      : template ? { icon: template.icon, tone: template.tone } : habitAppearance(value.title);
    try {
      await onSave({ kind: 'habit', requestId: key.current, revision: entry?.revision, payload: { ...value, ...appearance,
        weekdays: value.weekdays.length ? value.weekdays : [0, 1, 2, 3, 4, 5, 6],
        monthDays: value.monthDays.length ? value.monthDays : [1], reminders: remind ? value.reminders : [] } }, entry?.id);
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal fullScreen title={entry ? '编辑目标' : '新建目标'} className="habit-editor"
    onClose={busy ? () => {} : onClose}
    actions={<button type="submit" form="habit-editor-form" className="habit-save" disabled={busy}>{busy ? '保存中…' : '保存'}</button>}>
    <form id="habit-editor-form" className="habit-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <section className="habit-form-section">
          <div className="habit-section-heading"><h3>推荐目标</h3><button type="button" onClick={() => setPicker('templates')}>全部<ChevronRight size={15} /></button></div>
          <div className="habit-template-shortcuts">{['早起', '早睡', '喝8杯水', '阅读', '背单词'].map(title => {
            const item = templates.find(item => item.title === title);
            return <button key={title} type="button" onClick={() => applyTemplate(item)}><HabitIcon icon={item.icon} size={15} />{title}</button>;
          })}</div>
          <label>习惯名称<input aria-label="习惯名称" maxLength={80} required value={value.title} onChange={event => update({ title: event.target.value })} placeholder="目标名称" /></label>
        </section>
        <section className="habit-form-section">
          <h3>重复周期</h3>
          <div className="habit-repeat-tabs" role="group" aria-label="重复周期">{HABIT_REPEATS.map(([repeat, label]) => <button type="button" key={repeat} aria-pressed={value.repeat === repeat}
            onClick={() => update({ repeat, targetCount: Math.min(value.targetCount, repeat === 'week-flex' ? 7 : 31) })}>{label}</button>)}</div>
          {value.repeat === 'weekly' && <div className="habit-days">{WEEKDAYS.map((day, index) => <button type="button" key={day} aria-label={day} aria-pressed={value.weekdays.includes(index)} onClick={() => toggleDay('weekdays', index)}>{day.slice(1)}</button>)}</div>}
          {value.repeat === 'monthly' && <div className="habit-days habit-month-days">{Array.from({ length: 31 }, (_, index) => index + 1).map(day => <button type="button" key={day} aria-label={`每月${day}日`} aria-pressed={value.monthDays.includes(day)} onClick={() => toggleDay('monthDays', day)}>{day}</button>)}</div>}
          {value.repeat.endsWith('-flex') && <label className="habit-inline-field">{value.repeat === 'week-flex' ? '每周次数' : '每月次数'}<input type="number" min={1} max={value.repeat === 'week-flex' ? 7 : 31} required value={value.targetCount} onChange={event => update({ targetCount: Number(event.target.value) })} /></label>}
          <label className="habit-switch-row">跳过法定节假日<input type="checkbox" role="switch" checked={value.skipHolidays} onChange={event => update({ skipHolidays: event.target.checked })} /></label>
        </section>
        <section className="habit-form-section">
          <label className="habit-switch-row"><span><Timer size={18} />专注模式</span><input type="checkbox" role="switch" checked={value.focus} onChange={event => update({ focus: event.target.checked })} /></label>
          {value.focus && <label className="habit-inline-field">专注时长（分钟）<input type="number" min={1} max={180} required value={value.focusMinutes} onChange={event => update({ focusMinutes: Number(event.target.value) })} /></label>}
        </section>
        <section className="habit-form-section">
          <h3>提醒设置</h3>
          <label className="habit-switch-row"><span><Bell size={18} />提醒</span><input type="checkbox" role="switch" checked={remind} onChange={event => { setRemind(event.target.checked); if (event.target.checked && !value.reminders.length) update({ reminders: ['09:00'] }); }} /></label>
          {remind && <div className="habit-reminder-times">{value.reminders.map((time, index) => <div key={index}><DateInput type="time" aria-label={`提醒时间${index + 1}`} required value={time} onChange={event => update({ reminders: value.reminders.map((item, i) => i === index ? event.target.value : item) })} /><button type="button" className="planner-icon" aria-label={`删除提醒${index + 1}`} title="删除提醒" onClick={() => update({ reminders: value.reminders.filter((_, i) => i !== index) })}><X size={16} /></button></div>)}<button type="button" className="planner-icon" aria-label="添加提醒时间" title="添加提醒时间" disabled={value.reminders.length >= 8} onClick={() => update({ reminders: [...value.reminders, ''] })}><Plus size={20} /></button></div>}
        </section>
        <section className="habit-form-section">
          <h3>目标时间</h3>
          <div className="habit-date-fields"><label>开始日期<DateInput type="date" required min="1901-01-01" max="2100-12-31" value={value.startDate} onChange={event => update({ startDate: event.target.value })} /></label><label>结束日期<DateInput type="date" min={value.startDate} max="2100-12-31" disabled={!value.endDate} value={value.endDate} onChange={event => update({ endDate: event.target.value })} /></label></div>
          <label className="habit-switch-row">无限期目标<input type="checkbox" role="switch" checked={!value.endDate} onChange={event => update({ endDate: event.target.checked ? '' : value.startDate })} /></label>
        </section>
        <section className="habit-form-section"><label>备注<textarea rows={2} maxLength={500} value={value.note} onChange={event => update({ note: event.target.value })} /></label></section>
      </fieldset>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions">{entry && <button type="button" className="planner-delete-button" disabled={busy} onClick={onDelete}><Trash2 size={16} />删除习惯</button>}<button className="secondary" type="button" disabled={busy} onClick={onClose}>取消</button></div>
    </form>
    {picker && <Choices title="推荐目标" onClose={() => setPicker('')}>
      <div className="habit-template-tabs" role="tablist" aria-label="推荐目标分类">{['推荐', ...HABIT_TEMPLATE_CATEGORIES].map(name => <button type="button" role="tab" key={name} aria-selected={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
        <div className="habit-template-grid">{templates.filter(item => category === '推荐' ? ['早起', '早睡', '喝8杯水', '阅读', '运动', '每日记账', '制定今日计划', '记录心情'].includes(item.title) : item.category === category).map(item => <button type="button" key={item.title} aria-label={item.title} onClick={() => applyTemplate(item)}><span className={`planner-habit-icon planner-tone-${item.tone}`}><HabitIcon icon={item.icon} /></span><span><strong>{item.title}</strong><small>{habitRepeatLabel(item)}</small><small>{item.time || '不提醒'}{item.focus ? ` · 专注${item.focusMinutes}分钟` : ''}</small></span></button>)}</div>
        <footer><button type="button" className="primary" onClick={() => setPicker('')}>创建自定义目标</button></footer>
    </Choices>}
  </Modal>;
}

export function HabitStats({ Modal, habits, checks, today, onClose }) {
  const [range, setRange] = useState(7);
  const days = Array.from({ length: range }, (_, index) => shiftDate(today, index - range + 1));
  const activeChecks = checks.filter(check => days.includes(check.date));
  return <Modal title="打卡统计" onClose={onClose} className="habit-stats">
    <div className="habit-repeat-tabs" role="group" aria-label="统计范围">{[7, 30].map(count => <button key={count} aria-pressed={range === count} onClick={() => setRange(count)}>最近{count}天</button>)}</div>
    <div className="habit-stat-totals"><div><strong>{activeChecks.length}</strong><span>累计打卡</span></div><div><strong>{new Set(activeChecks.map(item => item.date)).size}</strong><span>活跃天数</span></div><div><strong>{habits.length}</strong><span>全部目标</span></div></div>
    <div className="habit-chart" role="img" aria-label={`最近${range}天每日打卡次数`}>{days.map(date => {
      const count = activeChecks.filter(check => check.date === date).length;
      return <div key={date} title={`${date}：${count}次`}><i style={{ height: `${count ? Math.max(5, count / Math.max(1, habits.length) * 100) : 2}%` }} /><small>{range === 7 ? Number(date.slice(8)) : ''}</small></div>;
    })}</div>
    <div className="habit-stats-list">{habits.map(habit => {
      const dates = checkedDates(checks, habit.id);
      const total = days.filter(date => dates.has(date)).length;
      const planned = days.filter(date => habitScheduled(habit, date)).length;
      return <div key={habit.id}><span className={`planner-habit-icon planner-tone-${habit.payload.tone}`}><HabitIcon icon={habit.payload.icon} /></span><span><strong>{habit.payload.title}</strong><small>{habitRepeatLabel(habit.payload)}</small></span><b>{total}<small> / {planned}天</small></b></div>;
    })}</div>
  </Modal>;
}

export function HabitFocus({ Modal, entry, session, storageKey, onClose, onComplete }) {
  const [timer, setTimer] = useState(session);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const remaining = Math.max(0, timer.deadline ? timer.deadline - now : timer.remaining);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(timer)); }, [timer, storageKey]);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(interval); }, []);
  async function complete() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await onComplete(entry, timer.date);
      localStorage.removeItem(storageKey); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); saving.current = false; }
  }
  useEffect(() => { if (!remaining && !error) void complete(); }, [remaining]);
  function stop() {
    if (busy || !window.confirm('结束本次专注？未完成的计时不会打卡。')) return;
    localStorage.removeItem(storageKey); onClose();
  }
  const seconds = Math.ceil(remaining / 1000);
  return <Modal title="专注模式" onClose={stop} className="habit-focus">
    <span className={`planner-habit-icon planner-tone-${entry.payload.tone}`}><HabitIcon icon={entry.payload.icon} size={28} /></span>
    <h3>{entry.payload.title}</h3>
    <time className="habit-countdown" aria-label="专注倒计时">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</time>
    <p role="status">{busy ? '正在完成打卡…' : !remaining ? '专注已完成' : timer.deadline ? '专注中' : '已暂停'}</p>
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={stop}><Square size={16} />结束</button>
      {remaining > 0 ? <button type="button" className="primary" onClick={() => {
        const current = Date.now(); setNow(current);
        setTimer(previous => previous.deadline ? { ...previous, deadline: null, remaining: Math.max(0, previous.deadline - current) } : { ...previous, deadline: current + previous.remaining });
      }}>{timer.deadline ? <Pause size={18} /> : <Play size={18} />}{timer.deadline ? '暂停' : '继续'}</button> :
        error && <button type="button" className="primary" disabled={busy} onClick={complete}>重试打卡</button>}
    </div>
  </Modal>;
}

export function habitStatusText(item, dates, selected) {
  const p = item.payload;
  if (p.repeat?.endsWith('-flex')) return `${p.repeat === 'week-flex' ? '本周' : '本月'} ${habitProgress(item, dates, selected)} / ${p.targetCount} 次`;
  return `已打卡 ${dates.size} 天`;
}
