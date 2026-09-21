import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import './ledger-date-picker.css';
import { DateWheel } from './date-picker';

export function LedgerDatePicker({ month, date, today, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState([0, 1, 0]);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  const [currentYear, currentMonth, currentDay] = today.split('-').map(Number);
  const [year, selectedMonth, day] = draft;
  const maxMonth = year === currentYear ? currentMonth : 12;
  function dayLimit(y, m) {
    const first = new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() + 1, 0);
    return y === currentYear && m === currentMonth ? currentDay : first.getUTCDate();
  }
  function update(position, value) {
    setDraft(previous => {
      const next = [...previous];
      next[position] = value;
      next[1] = Math.min(next[1], next[0] === currentYear ? currentMonth : 12);
      next[2] = Math.min(next[2], dayLimit(next[0], next[1]));
      return next;
    });
  }
  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function apply(wholeMonth = false) {
    const nextMonth = `${String(year).padStart(4, '0')}-${String(selectedMonth).padStart(2, '0')}`;
    onChange(nextMonth, wholeMonth || !day ? '' : `${nextMonth}-${String(day).padStart(2, '0')}`);
    close();
  }
  useLayoutEffect(() => { if (open) dialog.current.showModal(); }, [open]);
  return <div className="ledger-date-picker">
    <button type="button" className="ledger-date-trigger" ref={trigger} aria-label="选择账目日期"
      title={date || `${month} · 整月`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => { setDraft([Number(month.slice(0, 4)), Number(month.slice(5)), date ? Number(date.slice(8)) : 0]); setOpen(true); }}>
      <CalendarDays size={19} />
    </button>
    {open && <dialog className="ledger-date-dialog" ref={dialog} id={id} aria-label="选择账目日期"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === dialog.current) {
        const box = dialog.current.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      } }}>
      <header className="ledger-date-heading">
        <strong>选择日期</strong>
        <button type="button" className="icon-button" aria-label="关闭日期选择" title="关闭日期选择" onClick={close}><X size={18} /></button>
      </header>
      <div className="date-wheels">
        <DateWheel label="年" values={Array.from({ length: currentYear }, (_, i) => i + 1)} value={year} onChange={value => update(0, value)} />
        <DateWheel label="月" values={Array.from({ length: maxMonth }, (_, i) => i + 1)} value={selectedMonth} onChange={value => update(1, value)} />
        <DateWheel label="日" values={Array.from({ length: dayLimit(year, selectedMonth) + 1 }, (_, i) => i)} value={day} onChange={value => update(2, value)} />
      </div>
      <footer className="ledger-date-actions">
        <button type="button" onClick={() => apply(true)}>查看整月</button>
        <button type="button" className="date-confirm" onClick={() => apply()}>确定</button>
      </footer>
    </dialog>}
  </div>;
}
