import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, CircleAlert } from 'lucide-react';
import { WEEKDAYS, plannerToday, weekday, shiftDate } from '../shared/planner.mjs';
import { courseLessons, courseConflicts, defaultCourseSettings, lessonTime } from '../shared/courses.mjs';
import { DateInput } from './date-picker';
import { syncReminders } from './api';
import { requestId } from './navigation';
import './courses.css';

function Icon({ label, icon: Glyph, ...props }) {
  return <button type="button" className="planner-icon" aria-label={label} title={label} {...props}><Glyph size={19} /></button>;
}
function Settings({ Modal, value, onSave, onClose, onNotify }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const update = patch => { setDraft(previous => ({ ...previous, ...patch })); setError(''); };
  return <Modal fullScreen className="planner-editor course-editor" title="作息与提醒" onClose={busy ? () => {} : onClose}>
    <form className="record-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('');
      try { await onSave(draft); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <label>我的授课姓名<input value={draft.myTeacher} maxLength={40} onChange={event => update({ myTeacher: event.target.value })} /></label>
      <h3>作息时间</h3>
      <div className="course-bell-row muted"><span>节次</span><span>上课</span><span>下课</span></div>
      {draft.bells.map((bell, index) => <div className="course-bell-row" key={index}><span>第{index + 1}节</span>
        {['start', 'end'].map(key => <DateInput key={key} type="time" required aria-label={`第${index + 1}节${key === 'start' ? '开始' : '结束'}`} value={bell[key]}
          onChange={event => update({ confirmed: false, reminders: false, bells: draft.bells.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item) })} />)}
      </div>)}
      <div className="course-bell-actions"><Icon label="增加节次" icon={Plus} disabled={draft.bells.length >= 20} onClick={() => update({ bells: [...draft.bells, { start: '', end: '' }], confirmed: false, reminders: false })} />
        <Icon label="删除最后节次" icon={Trash2} disabled={draft.bells.length <= 1} onClick={() => update({ bells: draft.bells.slice(0, -1), confirmed: false, reminders: false })} /></div>
      <label className="course-switch"><span>已核对作息时间</span><input type="checkbox" checked={draft.confirmed} onChange={event => update({ confirmed: event.target.checked, reminders: event.target.checked && draft.reminders })} /></label>
      <label className="course-switch"><span>课前提醒</span><input type="checkbox" role="switch" disabled={busy} checked={draft.reminders} onChange={event => {
        if (event.target.checked && !draft.myTeacher.trim()) {
          onNotify('请先填写我的授课姓名，以便匹配需要提醒的课程');
          return;
        }
        if (event.target.checked && !draft.confirmed) {
          onNotify('请先勾选“已核对作息时间”，再开启课前提醒');
          return;
        }
        update({ reminders: event.target.checked });
      }} /></label>
      {draft.reminders && <label>提前分钟数<input type="number" min={0} max={120} required value={draft.leadMinutes} onChange={event => update({ leadMinutes: Number(event.target.value) })} /></label>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存</button></div>
    </form>
  </Modal>;
}
function Lesson({ Modal, lesson, events, onClose, onSave, onEdit }) {
  const [draft, setDraft] = useState({ date: lesson.date, order: lesson.order, teacher: lesson.teacher || '',
    room: lesson.room || '', note: lesson.note || '', photos: lesson.photos || [], reason: lesson.reason || '', cancelled: Boolean(lesson.cancelled) });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(requestId());
  const update = patch => setDraft(previous => ({ ...previous, ...patch }));
  const history = events.filter(event => event.course_id === lesson.course.id && event.source_date === lesson.sourceDate);
  return <Modal fullScreen className="planner-editor course-editor" title="本次课程" onClose={busy ? () => {} : onClose}>
    <form className="record-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('');
      try {
        await onSave({ requestId: key.current, sourceDate: lesson.sourceDate, revision: lesson.event?.id || '',
          payload: draft });
        onClose();
      } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <div className="course-detail-heading"><div><h3>{lesson.title}</h3><p>{lesson.className || '未分班'} · 原定{lesson.sourceDate} 第{lesson.course.payload.order}节</p></div>
        <Icon label="编辑每周课程" icon={Pencil} disabled={busy} onClick={onEdit} /></div>
      <div className="form-columns"><label>本次上课日期<DateInput type="date" required value={draft.date} onChange={event => update({ date: event.target.value })} /></label>
        <label>本次节次<input type="number" min={1} max={20} required value={draft.order} onChange={event => update({ order: Number(event.target.value) })} /></label></div>
      <div className="form-columns"><label>本次授课老师<input value={draft.teacher} maxLength={40} onChange={event => update({ teacher: event.target.value })} /></label>
        <label>本次教室<input value={draft.room} maxLength={60} onChange={event => update({ room: event.target.value })} /></label></div>
      <label>变更原因<input maxLength={200} value={draft.reason} onChange={event => update({ reason: event.target.value })} /></label>
      <label className="course-switch"><span>本次停课</span><input type="checkbox" checked={draft.cancelled} onChange={event => update({ cancelled: event.target.checked })} /></label>
      <label>教学进度与备课备注<textarea rows={3} maxLength={2000} value={draft.note} onChange={event => update({ note: event.target.value })} /></label>
      <button type="button" className="secondary" disabled={busy} onClick={() => update({ date: lesson.sourceDate, order: lesson.course.payload.order,
        teacher: lesson.course.payload.teacher || '', room: lesson.course.payload.room || '', cancelled: false, reason: '恢复原安排' })}>恢复原安排</button>
      {history.length > 0 && <details className="course-history"><summary>本节变更记录 · {history.length}</summary>{[...history].reverse().map(event =>
        <p key={event.id}><time>{new Date(event.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time><br />
          {event.payload.cancelled ? '停课' : `${event.payload.date} 第${event.payload.order}节 · ${event.payload.teacher || '未填老师'} · ${event.payload.room || '未填教室'}`}
          {event.payload.reason && ` · ${event.payload.reason}`}{event.payload.note && <span className="course-history-note">{event.payload.note}</span>}
        </p>)}</details>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存本次</button></div>
    </form>
  </Modal>;
}

export function CourseBoard({ data, Modal, mutate, records, onNotify, onEdit, onAdd }) {
  const settings = data.courseSettings || defaultCourseSettings();
  const events = data.courseEvents || [];
  const courses = data.items.filter(item => item.kind === 'course');
  const [now, setNow] = useState(Date.now), [week, setWeek] = useState(plannerToday);
  const [mode, setMode] = useState('mine'), [className, setClassName] = useState('');
  const [dialog, setDialog] = useState(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const today = plannerToday(now), monday = shiftDate(week, -weekday(week)), sunday = shiftDate(monday, 6);
  const lessons = courseLessons(courses, events, monday, sunday);
  const mine = settings.myTeacher;
  const needsIdentity = mode === 'mine' && !mine;
  const needsClass = !className;
  const matchesView = lesson => Boolean(className) && (lesson.className || '未分班') === className
    && (mode !== 'mine' || Boolean(mine) && lesson.teacher === mine);
  const visible = lessons.filter(matchesView);
  const daily = courseLessons(courses, events, today, today).filter(matchesView);
  const current = daily.filter(lesson => { const time = lessonTime(lesson, settings); return time && time.start <= now && time.end > now; });
  const next = daily.find(lesson => { const time = lessonTime(lesson, settings); return time && time.start > now; });
  const finished = daily.filter(lesson => { const time = lessonTime(lesson, settings); return time && time.end <= now; }).length;
  const visibleKeys = new Set(visible.map(lesson => lesson.key));
  const conflicts = courseConflicts(lessons).filter(({ a, b }) => visibleKeys.has(a.key) || visibleKeys.has(b.key));
  const conflictKeys = new Set(conflicts.flatMap(item => [item.a.key, item.b.key]));
  const classes = [...new Set(courses.map(item => item.payload.className || '未分班'))].sort();
  const myHistoryKeys = new Set(events.filter(event => mine && event.payload.teacher === mine).map(event => `${event.course_id}:${event.source_date}`));
  const historyEvents = events.filter(event => {
    const course = courses.find(item => item.id === event.course_id);
    return Boolean(className) && (course?.payload.className || '未分班') === className
      && (mode !== 'mine' || Boolean(mine) && (course?.payload.teacher === mine || myHistoryKeys.has(`${event.course_id}:${event.source_date}`)));
  });
  const lessonLabel = lesson => [lesson.title, lesson.className, lesson.room].filter(Boolean).join(' · ');
  function addSlot(index, order, teacher = mine) {
    onAdd({ weekdays: [index], order, teacher: mode === 'mine' ? teacher : undefined,
      className: className !== '未分班' ? className : '',
      requireClass: className !== '未分班' }, payload => {
      setClassName(payload.className.trim() || '未分班');
    });
  }
  function fromEvent(event) {
    const course = courses.find(item => item.id === event.course_id);
    const last = events.filter(item => item.course_id === event.course_id && item.source_date === event.source_date).at(-1);
    return { ...course.payload, ...last.payload, sourceDate: event.source_date, course, event: last };
  }
  return <div className="course-board">
    <div className="course-controls">
      <div className="task-reminder-modes" role="group" aria-label="课表视图">{[['mine', '我的授课'], ['class', '班级课表'], ['history', '代课记录']].map(([value, label]) =>
        <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
    </div>
    <div className="course-filters">
      <select aria-label="班级选择" value={className} onChange={event => setClassName(event.target.value)}><option value="">班级选择</option>{classes.map(name => <option key={name}>{name}</option>)}</select>
      {mode !== 'history' && <><Icon label="课表上一周" icon={ChevronLeft} onClick={() => setWeek(shiftDate(monday, -7))} />
      <DateInput type="date" aria-label="课表周日期" value={week} onChange={event => { if (event.target.value) setWeek(event.target.value); }} />
      <Icon label="课表下一周" icon={ChevronRight} onClick={() => setWeek(shiftDate(monday, 7))} />
      <button className="planner-today" onClick={() => setWeek(today)}>本周</button></>}
    </div>
    {mode !== 'history' && <><div className="course-status-band"><div className="course-summary"><span>今日 <strong>{daily.length}</strong> 节</span>{settings.confirmed || !daily.length
      ? <><span>已上 {finished}</span><span>剩余 {daily.length - finished}</span></>
      : <button onClick={() => setDialog({ type: 'settings' })}>作息待确认</button>}</div>
    <div className="course-now"><span>当前：{!settings.confirmed && daily.length ? '作息待确认' : current.length ? current.map(lessonLabel).join(' / ') : '无课'}</span>
      <span>下一节：<strong>{!settings.confirmed && daily.length ? '作息待确认' : next ? `${settings.bells[next.order - 1].start} ${lessonLabel(next)}` : '今日无后续课程'}</strong></span></div></div>
    {conflicts.length > 0 && <details className="course-conflicts"><summary><CircleAlert size={15} />{conflicts.length} 处时间冲突</summary>
      {conflicts.map(({ a, b, reasons }) => <button key={`${a.key}:${b.key}`} onClick={() => setDialog({ type: 'lesson', lesson: a })}>
        {a.date} 第{a.order}节 · {a.title} / {b.title} · {reasons.join('、')}冲突</button>)}</details>}
    <table className="planner-course-grid" aria-label="每周课程表">
        <colgroup><col className="planner-period-column" />{WEEKDAYS.map(day => <col key={day} />)}</colgroup>
        <thead><tr><th scope="col">节次</th>{WEEKDAYS.map((day, index) => <th scope="col" key={day} aria-current={shiftDate(monday, index) === today ? 'date' : undefined}>{day}<small>{Number(shiftDate(monday, index).slice(8))}</small></th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.max(7, settings.bells.length, ...visible.map(lesson => lesson.order)) }, (_, index) => index + 1).map(order =>
          <tr key={order}><th scope="row">{order}</th>{WEEKDAYS.map((day, index) => <td key={day}>
            {!visible.some(lesson => lesson.order === order && lesson.date === shiftDate(monday, index)) &&
              <button type="button" className="course-empty-slot" aria-label={`添加${day}第${order}节课程`} title={`添加${day}第${order}节课程`}
                onClick={() => needsIdentity ? setDialog({ type: 'settings', slot: { index, order } }) : addSlot(index, order)}><Plus size={14} /></button>}
            {visible.filter(lesson => lesson.order === order && lesson.date === shiftDate(monday, index)).map(lesson =>
              <button className={`planner-course planner-tone-${lesson.tone}${current.some(item => item.key === lesson.key) ? ' is-current' : ''}${next?.key === lesson.key ? ' is-next' : ''}`}
                key={lesson.key} aria-label={`${day}第${order}节 ${lesson.title}`} title={lessonLabel(lesson)} onClick={() => setDialog({ type: 'lesson', lesson })}>
                <strong>{lesson.title}</strong>{mode === 'mine' ? lesson.className && <small>{lesson.className}</small> : lesson.teacher && <small>{lesson.teacher}</small>}
                {lesson.room && <small>{lesson.room}</small>}{lesson.changed && <small>已调整</small>}{conflictKeys.has(lesson.key) && <CircleAlert size={12} aria-label="时间冲突" />}
              </button>)}
          </td>)}</tr>)}</tbody>
      </table></>}
    {dialog?.type === 'settings' && <Settings Modal={Modal} value={settings} onNotify={onNotify} onClose={() => setDialog(null)} onSave={async draft => {
      if (dialog.slot && !draft.myTeacher.trim()) throw new Error('请填写我的授课姓名');
      const next = await mutate('/planner/course-settings', { method: 'PUT', body: draft });
      if (draft.reminders) syncReminders(records, true).catch(error => onNotify(error.message));
      if (dialog.slot) addSlot(dialog.slot.index, dialog.slot.order, next.courseSettings.myTeacher);
    }} />}
    {dialog?.type === 'lesson' && <Lesson Modal={Modal} lesson={dialog.lesson} events={events} onClose={() => setDialog(null)}
      onEdit={() => { const course = dialog.lesson.course; setDialog(null); onEdit(course); }}
      onSave={body => mutate(`/planner/${dialog.lesson.course.id}/lesson`, { method: 'POST', body })} />}
    {mode === 'history' && <section className="course-history-page" aria-label="代课记录">
      {!historyEvents.length && <p className="muted">{needsClass ? '请选择班级' : '暂无代课记录'}</p>}
      {[...historyEvents].reverse().map(event => { const course = courses.find(item => item.id === event.course_id); return course && <button key={event.id} className="course-history-row" onClick={() => setDialog({ type: 'lesson', lesson: fromEvent(event) })}>
        <strong>{course.payload.title} · {course.payload.className || '未分班'}</strong><span>原定 {event.source_date} → {event.payload.cancelled ? '停课' : `${event.payload.date} 第${event.payload.order}节`}</span>
        <small>{event.payload.teacher} {event.payload.reason} · {new Date(event.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</small>
      </button>; })}
    </section>}
  </div>;
}
