import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Delete, Check, ArrowUp } from 'lucide-react';
import { isNative } from './api';
import './preview-keyboard.css';

const keyboardFields = 'input[inputmode="decimal"],input[type="text"],input:not([type]),textarea';

export function PreviewKeyboard({ dialogRef }) {
  const [field, setField] = useState(null);
  const [text, setText] = useState('');
  const draft = useRef('');
  const composing = useRef(false);
  const [uppercase, setUppercase] = useState(false);
  const [symbols, setSymbols] = useState(false);
  useEffect(() => {
    if (isNative || new URLSearchParams(location.search).get('preview') !== 'phone'
      || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const dialog = dialogRef.current;
    let pointerDown = false;
    const beginPointer = () => { pointerDown = true; };
    const endPointer = () => {
      pointerDown = false;
      if (!dialog.contains(document.activeElement) || !document.activeElement.matches(keyboardFields)) setField(null);
    };
    const focus = event => {
      const input = event.target;
      if (!input.matches(keyboardFields) || input.disabled || input.readOnly) return;
      draft.current = input.value;
      setText(input.value);
      setField(input);
    };
    // Keep the layout stable until a pointer click reaches its intended button.
    const blur = () => { if (!pointerDown) setField(null); };
    const sync = event => {
      if (event.target.matches(keyboardFields)) {
        draft.current = event.target.value;
        setText(event.target.value);
      }
    };
    const startComposition = () => { composing.current = true; };
    const endComposition = () => { composing.current = false; };
    dialog.addEventListener('focusin', focus);
    dialog.addEventListener('focusout', blur);
    dialog.addEventListener('input', sync);
    dialog.addEventListener('compositionstart', startComposition);
    dialog.addEventListener('compositionend', endComposition);
    document.addEventListener('pointerdown', beginPointer, true);
    document.addEventListener('click', endPointer);
    document.addEventListener('pointercancel', endPointer);
    return () => {
      dialog.removeEventListener('focusin', focus);
      dialog.removeEventListener('focusout', blur);
      dialog.removeEventListener('input', sync);
      dialog.removeEventListener('compositionstart', startComposition);
      dialog.removeEventListener('compositionend', endComposition);
      document.removeEventListener('pointerdown', beginPointer, true);
      document.removeEventListener('click', endPointer);
      document.removeEventListener('pointercancel', endPointer);
    };
  }, [dialogRef]);
  useEffect(() => {
    if (!field) return;
    document.body.classList.add('preview-keyboard-open');
    const frame = requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest' }));
    const escape = event => {
      if (event.key === 'Escape' && !event.isComposing && !composing.current) {
        event.preventDefault();
        event.stopPropagation();
        field.blur();
      }
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove('preview-keyboard-open');
      document.removeEventListener('keydown', escape, true);
    };
  }, [field]);
  if (!field) return null;
  const numeric = field.inputMode === 'decimal';
  function press(key) {
    if (!field.isConnected || field.disabled || field.readOnly) { setField(null); return; }
    if (composing.current) return;
    if (!numeric) {
      const value = field.value;
      let start = field.selectionStart ?? value.length;
      const end = field.selectionEnd ?? start;
      if (key === 'delete' && start === end) {
        const segments = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value.slice(0, start))];
        start = segments.at(-1)?.index ?? 0;
      }
      const insert = key === 'delete' ? '' : key;
      const next = value.slice(0, start) + insert + value.slice(end);
      if (field.maxLength >= 0 && next.length > field.maxLength) return;
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, next);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.setSelectionRange(start + insert.length, start + insert.length);
      draft.current = next;
      setText(next);
      return;
    }
    let next = draft.current;
    if (key === 'delete') next = next.slice(0, -1);
    else if (key === '.') {
      if (next.includes('.')) return;
      next = `${next || '0'}.`;
    } else next = next === '0' ? key : next + key;
    // Number inputs sanitize a trailing decimal point; keep it in the keypad readout.
    const value = next.endsWith('.') ? next.slice(0, -1) : next;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    draft.current = next;
    setText(next);
  }
  const rows = symbols ? ['1234567890', '@#￥%&*()-', '，。？！/：；'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return createPortal(<section className="preview-keyboard" aria-label={numeric ? '数字键盘' : '文字键盘'} onMouseDown={event => event.preventDefault()}>
    <div className="preview-keyboard-heading">
      <output aria-label={numeric ? '当前输入金额' : '当前输入文字'}>{text || (numeric ? '0' : '')}</output>
      <button type="button" onClick={() => field.blur()}><Check size={18} />完成</button>
    </div>
    {numeric ? <div className="preview-keyboard-keys">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'delete'].map(key =>
        <button type="button" tabIndex={-1} key={key} aria-label={key === 'delete' ? '删除一位' : key === '.' ? '小数点' : key}
          title={key === 'delete' ? '删除一位' : undefined} onClick={() => press(key)}>
          {key === 'delete' ? <Delete size={24} /> : key}
        </button>)}
    </div> : <div className="preview-text-keys">
      {rows.map((row, index) => <div className="preview-key-row" key={index}>
        {index === 2 && <button type="button" tabIndex={-1} aria-label="大写字母" aria-pressed={uppercase} disabled={symbols} onClick={() => setUppercase(value => !value)}><ArrowUp size={19} /></button>}
        {[...row].map(key => <button type="button" tabIndex={-1} key={key} onClick={() => press(uppercase && !symbols ? key.toUpperCase() : key)}>{uppercase && !symbols ? key.toUpperCase() : key}</button>)}
        {index === 2 && <button type="button" tabIndex={-1} aria-label="删除一位" title="删除一位" onClick={() => press('delete')}><Delete size={21} /></button>}
      </div>)}
      <div className="preview-key-row preview-key-bottom">
        <button type="button" tabIndex={-1} aria-label={symbols ? '切换字母' : '切换数字和符号'} onClick={() => setSymbols(value => !value)}>{symbols ? 'ABC' : '123'}</button>
        <button type="button" tabIndex={-1} onClick={() => press('，')}>，</button>
        <button type="button" tabIndex={-1} className="preview-space" onClick={() => press(' ')}>空格</button>
        <button type="button" tabIndex={-1} onClick={() => press('。')}>。</button>
      </div>
    </div>}
  </section>, document.body);
}
