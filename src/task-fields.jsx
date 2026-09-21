import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, BriefcaseBusiness, BookOpen, House, HeartPulse, Wallet, Shapes, ChevronDown, Check, X,
  Users, FolderKanban, Wrench, Package, ReceiptText, NotebookPen, ClipboardCheck, Library,
  Brush, ShoppingBag, Plane, Dumbbell, Stethoscope, Pill, CreditCard, ArrowUpRight, ArrowDownLeft, MessagesSquare } from 'lucide-react';
import { TASK_CATEGORIES, taskCategory } from '../shared/task-categories.mjs';
import { TASK_PRIORITIES, taskPriority } from '../shared/task-priorities.mjs';
import { request } from './api';
import './tasks.css';

const categoryIcons = {
  工作: BriefcaseBusiness, 会议: Users, 项目: FolderKanban, 后勤: Wrench, 采购: Package, 报销: ReceiptText,
  学习: BookOpen, 作业: NotebookPen, 考试: ClipboardCheck, 阅读: Library,
  生活: House, 家务: Brush, 购物: ShoppingBag, 出行: Plane,
  健康: HeartPulse, 运动: Dumbbell, 就医: Stethoscope, 用药: Pill,
  财务: Wallet, 缴费: CreditCard, 还款: ArrowUpRight, 收款: ArrowDownLeft, 社交: MessagesSquare, 其他: Shapes,
};
export function TaskCategoryIcon({ category, compact = false }) {
  const item = taskCategory(category), Icon = categoryIcons[item.label];
  return <span className={`task-category-icon${compact ? ' compact' : ''}`} style={{ '--category-color': item.color, '--category-soft': `${item.color}12` }} aria-hidden="true"><Icon size={compact ? 13 : 18} strokeWidth={1.8} /></span>;
}

function TaskCategoryField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef(null), trigger = useRef(null);
  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (open) {
      dialog.current.showModal();
      dialog.current.querySelector('[aria-pressed="true"]')?.focus();
    }
  }, [open]);
  return <div className="task-category-field">
    <span>待办分类</span><input type="hidden" name="category" value={value} />
    <button type="button" className="task-category-select" ref={trigger} aria-label="待办分类" aria-description={`当前分类：${value}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><TaskCategoryIcon category={value} /><span>{value}</span><ChevronDown size={16} /></button>
    {open && createPortal(<dialog className="task-category-dialog" ref={dialog} aria-label="选择待办分类"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => {
        if (event.target !== dialog.current) return;
        const rect = dialog.current.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}>
      <header><strong>待办分类</strong><button type="button" className="icon-button" aria-label="关闭分类选择" title="关闭分类选择" onClick={close}><X size={18} /></button></header>
      <div className="task-category-choices">{TASK_CATEGORIES.map(item => <button type="button" key={item.label} aria-pressed={value === item.label}
        onClick={() => { onChange(item.label); close(); }}><TaskCategoryIcon category={item.label} /><span>{item.label}</span>{value === item.label && <Check size={17} aria-hidden="true" />}</button>)}</div>
    </dialog>, document.body)}
  </div>;
}

export function TaskPriorityField({ value }) {
  return <fieldset className="task-priority-field"><legend>优先级</legend><div className="task-priority-options">
    {TASK_PRIORITIES.map(item => <label key={item.value} style={{ '--priority-color': item.color, '--priority-soft': item.soft }}>
      <input type="radio" name="priority" value={item.value} defaultChecked={taskPriority(value).value === item.value} />
      <span><CircleAlert size={17} aria-hidden="true" />{item.label}</span>
    </label>)}
  </div></fieldset>;
}

export function TaskFields({ initial, onBusyChange, defaultCategory = '' }) {
  const [title, setTitle] = useState(initial?.payload.title || '');
  const [category, setCategory] = useState(taskCategory(initial?.payload.category || defaultCategory).label);
  const [manual, setManual] = useState(Boolean(initial || defaultCategory));
  const revision = useRef(0);
  useEffect(() => {
    if (manual || title.trim().length < 2) { onBusyChange(false); return; }
    let active = true;
    const epoch = revision.current;
    const controller = new AbortController();
    let timeout;
    onBusyChange(true);
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await request('/tasks/classify', { method: 'POST', body: { title: title.trim() }, signal: controller.signal });
        if (!TASK_CATEGORIES.some(item => item.label === result.category)) throw new Error('Invalid category');
        if (active && revision.current === epoch) setCategory(result.category);
      } catch {
        if (active && revision.current === epoch) setCategory('其他');
      } finally {
        clearTimeout(timeout);
        if (active && revision.current === epoch) onBusyChange(false);
      }
    }, 900);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [title, manual, onBusyChange]);
  return <>
    <label>要做的事<input name="title" value={title} onChange={event => { revision.current++; setTitle(event.target.value); }} placeholder="比如：周五交材料" maxLength={160} required autoFocus /></label>
    <TaskCategoryField value={category} onChange={value => {
      revision.current++; setManual(true); setCategory(value); onBusyChange(false);
    }} />
  </>;
}
