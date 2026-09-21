import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './ledger-date-picker.css';

export function DateWheel({ label, values, value, onChange, ariaLabel = label }) {
  const root = useRef(null), id = useId();
  const index = Math.max(0, values.indexOf(value));
  useEffect(() => {
    if (Math.round(root.current.scrollTop / 40) !== index) root.current.scrollTop = index * 40;
  }, [index, values.length]);
  const choose = next => onChange(values[Math.max(0, Math.min(values.length - 1, next))]);
  return <div className="date-wheel-column">
    <span className="date-wheel-label">{label}</span>
    <div ref={root} className="date-wheel" role="listbox" aria-label={ariaLabel} tabIndex={0}
      aria-activedescendant={`${id}-${index}`}
      onScroll={event => {
        const next = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / 40)));
        if (next !== index) choose(next);
      }}
      onKeyDown={event => {
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: values.length - 1,
          PageDown: index + 5, PageUp: index - 5 }[event.key];
        if (next !== undefined) { event.preventDefault(); choose(next); }
      }}>
      {values.map((item, position) => <div id={`${id}-${position}`} key={item} role="option"
        aria-selected={item === value} className="date-wheel-option" onClick={() => choose(position)}>
        {item === 0 && label === '日' ? '整月' : `${label === '时' || label === '分' ? String(item).padStart(2, '0') : item}${label}`}
      </div>)}
    </div>
  </div>;
}

const parts = value => value.split(/[-T:]/).map(Number);
const range = (min, max) => Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
function format(value, type) {
  const padded = value.map((item, index) => String(item).padStart(index === 0 && type !== 'time' ? 4 : 2, '0'));
  if (type === 'time') return padded.join(':');
  return padded.slice(0, type === 'month' ? 2 : 3).join('-') + (type === 'datetime-local' ? `T${padded.slice(3).join(':')}` : '');
}
function dayCount(year, month) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}
function limits(draft, position, type, min, max) {
  const time = type === 'time';
  let lo = time || position >= 3 ? 0 : 1;
  let hi = time ? (position ? 59 : 23) : [9999, 12, dayCount(draft[0], draft[1]), 23, 59][position];
  if (min.slice(0, position).every((n, i) => n === draft[i])) lo = Math.max(lo, min[position]);
  if (max.slice(0, position).every((n, i) => n === draft[i])) hi = Math.min(hi, max[position]);
  return [lo, hi];
}

export function DatePickerDialog({ type = 'date', value, min, max, required = false, title,
  onChange, onClose }) {
  const now = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
  const fallback = type === 'time' ? now.slice(11) : now.slice(0, type === 'month' ? 7 : type === 'date' ? 10 : 16);
  const low = min || (type === 'time' ? '00:00' : `${Math.min(1901, Number((value || fallback).slice(0, 4)))}-01-01T00:00`.slice(0, fallback.length));
  const high = max || (type === 'time' ? '23:59' : `${Math.max(2100, Number((value || fallback).slice(0, 4)))}-12-31T23:59`.slice(0, fallback.length));
  const lower = parts(low), upper = parts(high);
  const clamp = values => {
    const result = [...values];
    result.forEach((_, index) => {
      const [lo, hi] = limits(result, index, type, lower, upper);
      result[index] = Math.max(lo, Math.min(hi, result[index]));
    });
    return result;
  };
  const [draft, setDraft] = useState(() => clamp(parts(value || fallback)));
  const ref = useRef(null);
  useLayoutEffect(() => {
    const prior = document.activeElement, element = ref.current;
    element.showModal();
    return () => {
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, []);
  const labels = type === 'time' ? ['时', '分'] : ['年', '月', '日', '时', '分'].slice(0, draft.length);
  const heading = title || ({ date: '选择日期', month: '选择月份', time: '选择时间', 'datetime-local': '选择提醒时间' }[type]);
  return createPortal(<dialog ref={ref} className="ledger-date-dialog unified-date-dialog" aria-label={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="ledger-date-heading"><strong>{heading}</strong>
      <button type="button" className="icon-button" aria-label="关闭日期选择" title="关闭日期选择" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="date-wheels" data-columns={draft.length} style={{ gridTemplateColumns: draft.length === 5
      ? 'minmax(0,1.4fr) repeat(4,minmax(0,1fr))' : `repeat(${draft.length},minmax(0,1fr))` }}>
      {labels.map((label, index) => {
        const [lo, hi] = limits(draft, index, type, lower, upper);
        return <DateWheel key={label} label={label} values={range(lo, hi)} value={draft[index]}
          onChange={value => setDraft(current => clamp(current.map((item, i) => i === index ? value : item)))} />;
      })}
    </div>
    <footer className={`ledger-date-actions${!required ? ' with-clear' : ''}`}>
      {!required && <button type="button" onClick={() => { onChange(''); onClose(); }}>清空</button>}
      <button type="button" onClick={onClose}>返回</button>
      <button type="button" className="date-confirm" onClick={() => { onChange(format(draft, type)); onClose(); }}>确定</button>
    </footer>
  </dialog>, document.body);
}

export function DateInput({ type = 'date', value, defaultValue = '', onChange, ...props }) {
  const [local, setLocal] = useState(defaultValue), [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = value === undefined ? local : value;
  function change(next) {
    const input = ref.current;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return <>
    <input {...props} ref={ref} type={type} value={current} className={`wheel-date-input ${props.className || ''}`}
      aria-haspopup="dialog" aria-expanded={open}
      onChange={event => { setLocal(event.target.value); onChange?.(event); }}
      onClick={event => { event.preventDefault(); if (!props.disabled && !props.readOnly) setOpen(true); }}
      onKeyDown={event => {
        if (['Enter', ' ', 'ArrowDown'].includes(event.key) && !props.disabled && !props.readOnly) { event.preventDefault(); setOpen(true); }
      }} />
    {open && <DatePickerDialog type={type} value={current} min={props.min} max={props.max} required={props.required}
      onChange={change} onClose={() => setOpen(false)} />}
  </>;
}
