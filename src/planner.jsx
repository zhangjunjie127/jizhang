import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ListChecks, Check, ChevronLeft, ChevronRight, ChevronDown, Plus, LayoutGrid, MoreHorizontal, CircleAlert, Clock3, GraduationCap, Heart, Flame, History, Pencil, Trash2, RefreshCw, ChartNoAxesCombined, Play } from 'lucide-react';
import { request, syncReminders } from './api';
import { requestId } from './navigation';
import { groupTasks, filterTasks, taskDate, TASK_PERIODS } from './tasks';
import { TASK_CATEGORIES, taskCategory } from '../shared/task-categories.mjs';
import { taskPriority } from '../shared/task-priorities.mjs';
import { taskReminderLabel } from '../shared/task-reminders.mjs';
import { WEEKDAYS, plannerToday, weekday, shiftDate, checkedDates, habitStreak, habitDue, habitRepeatLabel } from '../shared/planner.mjs';
import { courseTone } from '../shared/courses.mjs';
import './planner.css';
import { MonthCalendar, AnniversaryEditor, DayAlmanac, CalendarMonthPicker } from './planner-calendar';
import { TaskCategoryIcon } from './task-fields';
import { HabitEditor, HabitIcon, HabitStats, HabitFocus, habitStatusText } from './habits';
import { calendarInfo } from '../shared/calendar.mjs';
import { AddMenu } from './add-menu';
import { CourseBoard } from './courses';

const views = [['calendar', '日历', CalendarDays], ['habits', '打卡', Flame], ['courses', '课程表', GraduationCap]];
const shortDate = date => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
function IconAction({ label, icon: Icon, ...props }) {
  return <button type="button" className="planner-icon" aria-label={label} title={label} {...props}><Icon size={20} /></button>;
}
function EmptyPlanner({ text, onAdd, label }) {
  return <div className="planner-empty"><img src="/app-icon.png" alt="" /><p>{text}</p>{onAdd && <button className="planner-add-empty" onClick={onAdd}><Plus size={16} />{label}</button>}</div>;
}
function WeekStrip({ selected, onSelect, today, future = true }) {
  const monday = shiftDate(selected, -weekday(selected));
  return <div className="planner-week" aria-label="星期日期">
    {WEEKDAYS.map((label, index) => {
      const date = shiftDate(monday, index);
      const holiday = calendarInfo(date).holiday;
      return <button key={date} aria-label={date} aria-pressed={date === selected} aria-current={date === today ? 'date' : undefined} disabled={!future && date > today} onClick={() => onSelect(date)}><span>{label.slice(1)}</span><strong>{date === today ? '今' : Number(date.slice(8))}</strong>{holiday && <i className={`habit-week-holiday ${holiday.work ? 'work' : ''}`} aria-label={holiday.work ? '调休上班' : '放假'}>{holiday.work ? '班' : '休'}</i>}</button>;
    })}
  </div>;
}
function PlannerEditor({ Modal, entry, defaults, kind, day, myTeacher, onClose, onSave, onDelete, onCreated }) {
  const p = entry?.payload || defaults;
  const [days, setDays] = useState(p?.weekdays || [day]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(requestId());
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!days.length) { setError('请至少选择一个星期'); return; }
    const payload = { ...Object.fromEntries(new FormData(event.currentTarget)), weekdays: days };
    payload.tone = payload.title === p?.title ? p.tone : courseTone(payload.title);
    payload.order = Number(payload.order);
    setBusy(true); setError('');
    try { payload.photos = p?.photos || []; await onSave({ kind, payload, requestId: key.current, revision: entry?.revision }, entry?.id); onCreated?.(payload); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const name = '课程';
  return <Modal fullScreen className="planner-editor course-editor" title={`${entry ? '编辑' : '新建'}${name}`} onClose={busy ? () => {} : onClose}>
    <form className="record-form" onSubmit={submit}>
      <label>{name}名称<input name="title" maxLength={80} required defaultValue={p?.title || ''} placeholder="例如：英语" autoFocus /></label>
      <label>班级<input name="className" maxLength={40} required={Boolean(defaults?.requireClass)} defaultValue={p?.className || ''} placeholder="例如：七年级一班" /></label>
      <fieldset><legend>上课星期</legend><div className="planner-week-options">{WEEKDAYS.map((label, index) => <label key={label}><input type="checkbox" checked={days.includes(index)} onChange={event => setDays(previous => event.target.checked ? [...previous, index].sort() : previous.filter(day => day !== index))} /><span>{label}</span></label>)}</div></fieldset>
      <label>课程顺序<input type="number" name="order" min={1} max={20} step={1} inputMode="numeric" defaultValue={p?.order || 1} required /></label><div className="form-columns"><label>教室<input name="room" maxLength={60} defaultValue={p?.room || ''} /></label><label>老师<input name="teacher" maxLength={40} defaultValue={p?.teacher ?? myTeacher ?? ''} /></label></div>
      <label>备注<textarea name="note" maxLength={500} rows={3} defaultValue={p?.note || ''} /></label>
      {error && <p className="error-box" role="alert">{error}</p>}
      {entry && <button type="button" className="planner-delete-button" disabled={busy} onClick={onDelete}><Trash2 size={16} />删除{name}</button>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="primary" disabled={busy}><Check size={17} />{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </Modal>;
}

export function Planner({ records, Modal, onCreateTask, onEditTask, onComplete, onDeleteTask, pending, createSignal, onNotify, userId }) {
  const [view, setView] = useState('calendar');
  const [today, setToday] = useState(plannerToday);
  const [selected, setSelected] = useState(plannerToday);
  const [month, setMonth] = useState(() => plannerToday().slice(0, 7));
  const [period, setPeriod] = useState('all');
  const [category, setCategory] = useState('');
  const [completed, setCompleted] = useState(false);
  const courseDay = weekday(today);
  const [data, setData] = useState({ items: [], checks: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const focusKey = `zaizai-habit-focus-${userId}`;
  const [focusSession, setFocusSession] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(focusKey));
      return value && typeof value.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
        Number.isFinite(value.remaining) && (value.deadline === null || Number.isFinite(value.deadline)) ? value : null;
    } catch { return null; }
  });
  const mutating = useRef(false);
  const loadVersion = useRef(0);
  const initialSignal = useRef(createSignal);
  const scroll = useRef(null);
  const add = () => setDialog({ type: 'add' });
  useEffect(() => {
    if (initialSignal.current !== createSignal) { initialSignal.current = createSignal; add(); }
  }, [createSignal]);
  async function refresh() {
    const version = ++loadVersion.current;
    setLoading(true); setLoadError('');
    try { const next = await request('/planner'); if (version === loadVersion.current) setData(next); }
    catch (error) { if (version === loadVersion.current) setLoadError(error.message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(() => setToday(plannerToday()), 60000);
    return () => { loadVersion.current++; clearInterval(timer); };
  }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [view, period, category, selected, completed, courseDay]);
  async function mutate(path, options) {
    if (mutating.current) throw new Error('正在保存，请稍候');
    mutating.current = true; setBusy(true); ++loadVersion.current;
    try {
      const next = await request(path, options);
      setData(next); setLoadError('');
      window.dispatchEvent(new Event('planner-changed'));
      syncReminders(records).catch(error => onNotify(error.message));
      return next;
    } finally { mutating.current = false; setBusy(false); setLoading(false); }
  }
  const save = async (body, id) => {
    const next = await mutate(`/planner${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body });
    if (body.kind === 'habit' && body.payload.reminders?.length) {
      syncReminders(records, true).catch(error => onNotify(error.message));
    }
    return next;
  };
  const safe = action => async () => { try { await action(); } catch (error) { onNotify(error.message); } };
  const taskPool = filterTasks(records, 'all', view === 'calendar' ? '' : category);
  const scoped = view === 'calendar' ? taskPool.filter(record => taskDate(record) === selected)
    : period === 'unscheduled' ? taskPool.filter(record => !taskDate(record)) : filterTasks(records, period, category);
  const groups = groupTasks(scoped, completed);
  const taskCounts = [false, true].map(done => scoped.filter(record => Boolean(record.completed) === done).length);
  const dayTasks = new Map();
  for (const record of taskPool) {
    const date = taskDate(record);
    if (date) dayTasks.set(date, [...(dayTasks.get(date) || []), record]);
  }
  const habits = data.items.filter(item => item.kind === 'habit');
  const scheduledHabits = habits.filter(item => habitDue(item, checkedDates(data.checks, item.id), selected) || checkedDates(data.checks, item.id).has(selected));
  const doneHabits = scheduledHabits.filter(item => checkedDates(data.checks, item.id).has(selected)).length;
  function changeMonth(step) {
    const [year, value] = month.split('-').map(Number);
    const next = new Date(Date.UTC(year, value - 1 + step, 1)).toISOString().slice(0, 7);
    if (next < '1901-01' || next > '2100-12') return;
    setMonth(next); setSelected(`${next}-01`);
  }
  function switchView(next) {
    setView(next);
    if (next === 'habits' && selected > today) setSelected(today);
  }
  const categoryTone = taskCategory(category).color;
  const checkHabit = (item, date, checked = true) => mutate(`/planner/${item.id}/check`, { method: 'POST', body: { date, checked } });
  const focusHabit = habits.find(item => item.id === focusSession?.id);
  const taskRows = list => list.map(record => {
    const tone = taskCategory(record.payload.category);
    const priority = taskPriority(record.payload.priority);
    return <div className={`planner-task ${record.completed ? 'is-complete' : ''}`} key={record.id} data-task-id={record.id}>
      <button className="planner-check" aria-label={`${record.completed ? '恢复' : '完成'}${record.payload.title}`} aria-pressed={Boolean(record.completed)} disabled={busy} onClick={safe(async () => { setBusy(true); try { await onComplete(record); } finally { setBusy(false); } })}>{record.completed && <Check size={17} />}</button>
      <button className="planner-task-body" aria-label={`编辑${record.payload.title}`} onClick={() => { setDialog(null); onEditTask(record); }}>
        <strong>{record.payload.title}</strong>
        {record.payload.occurredDate && <span className="planner-task-meta"><time dateTime={record.payload.occurredDate}>发生于 {record.payload.occurredDate}</time></span>}
        {['weekly', 'monthly'].includes(record.payload.reminderRepeat) && <span className="planner-task-meta">{taskReminderLabel(record.payload)}</span>}
        <span className="planner-task-meta">{(!category || view === 'calendar') && <span><TaskCategoryIcon category={tone.label} compact />{tone.label}</span>}<span className="planner-task-priority" style={{ color: priority.color }}><CircleAlert size={13} aria-hidden="true" />{priority.label}</span>{record.payload.due && !['weekly', 'monthly'].includes(record.payload.reminderRepeat) && <time dateTime={record.payload.due}><Clock3 size={11} />{new Date(record.payload.due).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time>}</span>
        {record.payload.note && <small>{record.payload.note}</small>}
      </button>
      <IconAction label={`更多操作：${record.payload.title}`} icon={MoreHorizontal} onClick={() => setDialog({ type: 'task-menu', entry: record })} />
    </div>;
  });
  return <main className="planner-page">
    <header className="planner-heading"><h1>待办</h1></header>
    <div className="planner-views" role="tablist" aria-label="日程视图">{views.map(([value, label, Icon]) => <button role="tab" aria-selected={view === value || (view === 'list' && value === 'calendar')} aria-controls="planner-panel" key={value} id={`planner-tab-${value}`} onClick={() => switchView(value)}><Icon size={17} /><span>{label}</span></button>)}</div>
    <div className="planner-panel" id="planner-panel" role="tabpanel" aria-labelledby={`planner-tab-${view === 'list' ? 'calendar' : view}`}>
      {(view === 'list' || view === 'calendar') && <>
        <div className="planner-toolbar">
          {view === 'list' ? <label className="planner-scope"><select aria-label="日程范围" value={period} onChange={event => setPeriod(event.target.value)}>{TASK_PERIODS.map(([value, label]) => <option key={value} value={value}>{value === 'all' ? '全部日程' : label}</option>)}<option value="unscheduled">未排期</option></select></label>
            : <div className="planner-month-nav"><IconAction label="上个月" icon={ChevronLeft} disabled={month === '1901-01'} onClick={() => changeMonth(-1)} /><button className="planner-month-trigger" aria-label="日历月份" title="选择月份" data-month={month} aria-haspopup="dialog" aria-expanded={dialog?.type === 'month'} onClick={() => setDialog({ type: 'month' })}><span>{month.slice(0, 4)}年{Number(month.slice(5))}月</span><CalendarDays size={15} aria-hidden="true" /></button><IconAction label="下个月" icon={ChevronRight} disabled={month === '2100-12'} onClick={() => changeMonth(1)} /></div>}
          {view === 'calendar' && <div className="planner-toolbar-actions"><button className="planner-today" aria-label="今天" title="返回今天" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}><span className="planner-today-number">{Number(today.slice(8))}</span>日</button><IconAction label="清单" icon={ListChecks} onClick={() => switchView('list')} /></div>}
          {view === 'list' && <div className="planner-toolbar-actions"><IconAction label="返回日历" icon={CalendarDays} onClick={() => switchView('calendar')} /><button className="planner-category-trigger" aria-label={`分类筛选：${category || '全部分类'}`} title={`分类筛选：${category || '全部分类'}`} aria-haspopup="dialog" style={category ? { color: categoryTone } : undefined} onClick={() => setDialog({ type: 'categories' })}><LayoutGrid size={20} aria-hidden="true" /></button></div>}
        </div>
        {view === 'calendar' && <>
          {loadError && <div className="error-box" role="alert">{loadError}<button onClick={refresh}>重试</button></div>}
          {loading && <span className="planner-calendar-loading" role="status">加载纪念日…</span>}
          <MonthCalendar month={month} today={today} selected={selected} dayTasks={dayTasks}
            anniversaries={data.items.filter(item => item.kind === 'anniversary')} onSelect={setSelected}
            onTask={onEditTask} onAnniversary={entry => setDialog({ type: 'anniversary', entry })}
            onDay={(date, info, personal) => { setSelected(date); setDialog({ type: 'calendar-day', date, info, personal }); }} />
        </>}
        {view === 'list' && <div className="planner-status" role="group" aria-label="待办状态">{[false, true].map((done, index) => <button key={String(done)} aria-pressed={completed === done} onClick={() => setCompleted(done)}>{done ? '已完成' : '未完成'}<span>{taskCounts[index]}</span></button>)}</div>}
      </>}
      {view === 'habits' && <><div className="planner-toolbar"><label className="planner-date-select"><CalendarDays size={17} /><DateInput type="date" aria-label="打卡日期" max={today} value={selected} onChange={event => { if (event.target.value && event.target.value <= today) setSelected(event.target.value); }} /></label><div className="habit-week-actions"><IconAction label="打卡统计" icon={ChartNoAxesCombined} onClick={() => setDialog({ type: 'habit-stats' })} /><IconAction label="全部习惯" icon={ListChecks} onClick={() => setDialog({ type: 'habits' })} /></div></div><div className="habit-week-actions"><IconAction label="上一周" icon={ChevronLeft} onClick={() => setSelected(shiftDate(selected, -7))} /><button className="planner-today" onClick={() => setSelected(today)}>今天</button><IconAction label="下一周" icon={ChevronRight} disabled={shiftDate(selected, 7) > today} onClick={() => setSelected(shiftDate(selected, 7))} /></div><WeekStrip selected={selected} onSelect={setSelected} today={today} future={false} /><div className="planner-habit-progress"><span>{selected === today ? '今日打卡' : shortDate(selected)}</span><strong>{doneHabits}<small> / {scheduledHabits.length}</small></strong><progress max={Math.max(1, scheduledHabits.length)} value={doneHabits} aria-label="打卡完成进度" /></div></>}
      <div className={`planner-scroll${view === 'courses' ? ' planner-course-scroll' : ''}`} ref={scroll} hidden={view === 'calendar'}>
        {view === 'list' && <>{pending}{groups.length ? groups.map(group => <details className="planner-task-group" key={`${view}:${group.date || 'unscheduled'}`} open><summary><ChevronDown size={15} /><h2>{group.date ? group.label : '未排期'}</h2><span>{group.records.length}</span>{group.date && group.date < today && !completed && <small>待跟进</small>}</summary>{taskRows(group.records)}</details>) : <EmptyPlanner text={completed ? '还没有已完成的日程' : '暂时没有待办事项'} label="添加待办" onAdd={add} />}</>}
        {(view === 'habits' || view === 'courses') && <>
          {loading && <p className="planner-loading" role="status">加载中…</p>}
          {loadError && <div className="error-box" role="alert">{loadError}<button onClick={refresh}><RefreshCw size={15} />重试</button></div>}
          {!loading && !loadError && view === 'habits' && (scheduledHabits.length ? [false, true].map(done => {
            const items = scheduledHabits.filter(item => checkedDates(data.checks, item.id).has(selected) === done);
            return items.length > 0 && <section className="habit-list-group" key={String(done)}><h2>{done ? '已完成' : '未完成'}<span>{items.length}</span></h2>{items.map(item => {
              const dates = checkedDates(data.checks, item.id);
              const focus = item.payload.focus && selected === today && !done;
              return <div className={`planner-habit planner-tone-${item.payload.tone}`} key={item.id}><span className="planner-habit-icon"><HabitIcon icon={item.payload.icon} /></span><button className="planner-habit-body" onClick={() => setDialog({ type: 'history', entry: item })}><strong>{item.payload.title}</strong><small>{habitStatusText(item, dates, selected)}{item.payload.reminders?.length ? ` · ${item.payload.reminders.join(' / ')}` : ''}</small></button><button className={`planner-habit-check ${done ? 'checked' : ''}`} aria-label={`${done ? '取消打卡' : focus ? '开始专注' : '打卡'}${item.payload.title}`} aria-pressed={done} disabled={busy} onClick={safe(async () => {
                if (focus) { setFocusSession({ id: item.id, date: selected, remaining: item.payload.focusMinutes * 60000, deadline: Date.now() + item.payload.focusMinutes * 60000 }); return; }
                await checkHabit(item, selected, !done);
              })}>{done ? <Check size={21} /> : focus ? <Play size={19} /> : <Plus size={21} />}</button></div>;
            })}</section>;
          }) : <EmptyPlanner text={habits.length ? '这一天没有待完成目标' : '还没有习惯'} label="新建习惯" onAdd={add} />)}
          {!loading && !loadError && view === 'courses' && <CourseBoard data={data} Modal={Modal} mutate={mutate} records={records} onNotify={onNotify}
            onEdit={entry => setDialog({ type: 'edit', kind: 'course', entry })} onAdd={(defaults, onCreated) => setDialog({ type: 'edit', kind: 'course', defaults, onCreated })} />}
        </>}
      </div>
    </div>
    {dialog?.type === 'month' && <CalendarMonthPicker Modal={Modal} month={month} onClose={() => setDialog(null)} onChange={next => { if (next !== month) { setMonth(next); setSelected(`${next}-01`); } }} />}
    {dialog?.type === 'add' && <AddMenu Modal={Modal} title={{ habits: '添加打卡目标', courses: '添加课程' }[view] || '添加日程'} onClose={() => setDialog(null)}
      options={view === 'habits' ? [{ label: '新建目标', icon: Flame, onSelect: () => setDialog({ type: 'edit', kind: 'habit' }) }]
        : view === 'courses' ? [{ label: '新建课程', icon: GraduationCap, onSelect: () => setDialog({ type: 'edit', kind: 'course' }) }]
        : [{ label: '添加待办', icon: ListChecks, onSelect: () => {
          setDialog(null);
          onCreateTask(view === 'calendar' ? { scheduledDate: selected } : { category, ...(period === 'today' ? { scheduledDate: today } : {}) });
        } }, ...(view === 'calendar' ? [{ label: '添加纪念日', icon: Heart, onSelect: () => setDialog({ type: 'anniversary' }) }] : [])]} />}
    {dialog?.type === 'anniversary' && <AnniversaryEditor Modal={Modal} entry={dialog.entry} date={selected}
      onClose={() => setDialog(null)} onSave={save} onDelete={() => setDialog({ type: 'delete', entry: dialog.entry })} />}
    {dialog?.type === 'calendar-day' && <Modal title={dialog.date} onClose={() => setDialog(null)} className="planner-day-preview">
      <div className="planner-day-preview-body">
      <DayAlmanac key={dialog.date} date={dialog.date} info={dialog.info} />
      <h3 className="planner-day-section-title">纪念日<span>{dialog.personal.length}</span></h3>
      <div className="planner-manage-list">{dialog.personal.map(item => <button key={item.id} onClick={() => setDialog({ type: 'anniversary', entry: item })}><Heart size={18} /><span>{item.payload.title}</span><ChevronRight size={16} /></button>)}</div>
      {!dialog.personal.length && <p className="planner-day-empty">暂无纪念日</p>}
      <h3 className="planner-day-section-title">待办计划<span>{dayTasks.get(dialog.date)?.length || 0}</span></h3>
      {taskRows(dayTasks.get(dialog.date) || [])}
      {!dayTasks.get(dialog.date)?.length && <p className="planner-day-empty">暂无待办计划</p>}
      </div>
      <div className="modal-actions"><button className="secondary" onClick={() => setDialog({ type: 'anniversary' })}>添加纪念日</button><button className="primary" onClick={() => { onCreateTask({ scheduledDate: dialog.date }); setDialog(null); }}>添加待办</button></div>
    </Modal>}
    {dialog?.type === 'categories' && <Modal title="清单分类" className="planner-dialog" onClose={() => setDialog(null)}><div className="planner-category-list">{[{ label: '', color: '' }, ...TASK_CATEGORIES].map(item => <button key={item.label} aria-pressed={category === item.label} onClick={() => { setCategory(item.label); if (!['list', 'calendar'].includes(view)) setView('list'); setDialog(null); }}>{item.color ? <TaskCategoryIcon category={item.label} /> : <ListChecks size={18} />}<span>{item.label || '全部分类'}</span><small>{filterTasks(records, 'all', item.label).length}</small>{category === item.label && <Check size={17} />}</button>)}</div></Modal>}
    {dialog?.type === 'edit' && (dialog.kind === 'habit' ? <HabitEditor Modal={Modal} key={dialog.entry?.id || 'habit'} entry={dialog.entry} onClose={() => setDialog(null)} onSave={save} onDelete={() => setDialog({ type: 'delete', entry: dialog.entry })} /> : <PlannerEditor Modal={Modal} key={dialog.entry?.id || dialog.kind} entry={dialog.entry} defaults={dialog.defaults} onCreated={dialog.onCreated} kind={dialog.kind} day={courseDay} myTeacher={data.courseSettings?.myTeacher} onClose={() => setDialog(null)} onSave={save} onDelete={() => setDialog({ type: 'delete', entry: dialog.entry })} />)}
    {dialog?.type === 'habit-stats' && <HabitStats Modal={Modal} habits={habits} checks={data.checks} today={today} onClose={() => setDialog(null)} />}
    {focusSession && focusHabit && <HabitFocus Modal={Modal} entry={focusHabit} session={focusSession} storageKey={focusKey} onClose={() => setFocusSession(null)} onComplete={checkHabit} />}
    {dialog?.type === 'habits' && <Modal title="全部习惯" onClose={() => setDialog(null)}><div className="planner-manage-list">{habits.map(item => <button key={item.id} onClick={() => setDialog({ type: 'history', entry: item })}><HabitIcon icon={item.payload.icon} size={18} /><span>{item.payload.title}<small>{habitRepeatLabel(item.payload)}</small></span><ChevronRight size={16} /></button>)}{!habits.length && <p>还没有习惯</p>}<button onClick={() => setDialog({ type: 'edit', kind: 'habit' })}><Plus size={18} />新建习惯</button></div></Modal>}
    {dialog?.type === 'history' && (() => {
      const item = data.items.find(item => item.id === dialog.entry.id) || dialog.entry;
      const dates = checkedDates(data.checks, item.id);
      return <Modal title={item.payload.title} onClose={() => setDialog(null)} className="planner-dialog"><div className="planner-history"><div><History size={19} /><strong>累计打卡 {dates.size} 天</strong></div><p>{habitRepeatLabel(item.payload)} · 连续 {habitStreak(item, dates, today)} {item.payload.repeat?.endsWith('-flex') ? '个周期' : '次'}</p><h3>最近 28 天</h3><div className="planner-history-grid">{Array.from({ length: 28 }, (_, index) => shiftDate(today, index - 27)).map(date => <span key={date} className={dates.has(date) ? 'checked' : ''} aria-label={`${date} ${dates.has(date) ? '已打卡' : '未打卡'}`} title={date}>{Number(date.slice(8))}</span>)}</div>{item.payload.note && <p>{item.payload.note}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setDialog({ type: 'delete', entry: item })}><Trash2 size={16} />删除</button><button className="primary" onClick={() => setDialog({ type: 'edit', entry: item, kind: 'habit' })}><Pencil size={16} />编辑</button></div></div></Modal>;
    })()}
    {dialog?.type === 'task-menu' && <Modal title="待办操作" onClose={() => setDialog(null)}><div className="planner-manage-list"><button onClick={() => { onEditTask(dialog.entry); setDialog(null); }}><Pencil size={18} />编辑待办</button><button onClick={() => setDialog({ type: 'delete-task', entry: dialog.entry })}><Trash2 size={18} />移入回收站</button></div></Modal>}
    {dialog?.type === 'delete-task' && <Modal title="移入回收站" onClose={() => setDialog(null)}><p className="planner-delete-text">{dialog.entry.payload.title}</p><div className="modal-actions"><button className="secondary" onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy} onClick={safe(async () => { await onDeleteTask(dialog.entry); setDialog(null); })}>确认移入</button></div></Modal>}
    {dialog?.type === 'delete' && <Modal title={`删除${dialog.entry.kind === 'anniversary' ? '纪念日' : dialog.entry.kind === 'habit' ? '习惯' : '课程'}`} onClose={busy ? () => {} : () => setDialog(null)}><p className="planner-delete-text">确定删除“{dialog.entry.payload.title}”？</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy} onClick={safe(async () => { await mutate(`/planner/${dialog.entry.id}/remove`, { method: 'POST', body: { revision: dialog.entry.revision } }); setDialog(null); })}>确认删除</button></div></Modal>}
  </main>;
}
