import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, ChevronRight, Check, LoaderCircle, ShieldCheck } from 'lucide-react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, CategoryIcon, categoryTone } from './categories';
import { requestId as newRequestId } from './navigation';
import './expense-entry.css';
import { usePreferences } from './app-preferences';

export function ExpenseEntry({ Modal, initial, onClose, onSave, onDebt }) {
  const original = initial?.payload || {};
  const { preferences } = usePreferences();
  const [step, setStep] = useState(initial ? 2 : preferences.defaultDirection === 'ask' ? 0 : 1);
  const [direction, setDirection] = useState(original.direction || (preferences.defaultDirection === 'income' ? 'income' : 'expense'));
  const [category, setCategory] = useState(original.category || '');
  const [fields, setFields] = useState({
    amount: original.amount ?? (original.cents != null ? (original.cents / 100).toFixed(2) : ''),
    title: original.title || '',
    date: original.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const requestId = useRef(newRequestId());
  const entryRef = useRef(null);
  useEffect(() => {
    entryRef.current?.querySelector('.entry-scroll button')?.focus({ preventScroll: true });
  }, [step]);
  const presets = direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const categories = [...new Set([...presets, ...(original.category && direction === (original.direction || 'expense') ? [original.category] : [])])];
  const directionLabel = direction === 'income' ? '收入' : '支出';
  function chooseDirection(value) {
    if (value !== direction) setCategory('');
    setDirection(value);
    setStep(1);
    setError('');
  }
  function update(event) {
    setFields(previous => ({ ...previous, [event.target.name]: event.target.value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (saving.current) return;
    if (!category) { setStep(1); return; }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave('expense', { ...fields, category, direction }, initial, event.nativeEvent.submitter?.value || 'confirm', requestId.current);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const title = initial ? initial.status === 'pending' ? '核对并确认' : '修改记录' : '记一笔';
  return <Modal title={title} fullScreen onClose={busy ? () => {} : onClose}
    onBack={step > 0 && !busy ? () => { setStep(value => value - 1); setError(''); } : undefined}>
    <div className="expense-entry" data-step={step} ref={entryRef}>
      <ol className="entry-steps" aria-label="记账步骤">
        {['收支', '类别', '填写'].map((label, index) => <li key={label} className={index <= step ? 'is-reached' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={12} /> : index + 1}</span>{label}</li>)}
      </ol>
      {step === 0 && <section className="entry-scroll entry-direction" aria-label="选择收支">
        <h3>选择收支</h3>
        <button type="button" className="entry-direction-option expense-option" onClick={() => chooseDirection('expense')}><span className="entry-direction-icon"><ArrowUpRight size={26} /></span><strong>支出</strong><ChevronRight size={20} /></button>
        <button type="button" className="entry-direction-option income-option" onClick={() => chooseDirection('income')}><span className="entry-direction-icon"><ArrowDownLeft size={26} /></span><strong>收入</strong><ChevronRight size={20} /></button>
      </section>}
      {step === 1 && <>
        <div className="entry-direction-tabs" role="group" aria-label="收支类型">
          {['expense', 'income'].map(value => <button type="button" key={value} aria-pressed={direction === value} onClick={() => chooseDirection(value)}>{value === 'expense' ? '支出' : '收入'}</button>)}
        </div>
        <section className="entry-scroll entry-categories" aria-label={`${directionLabel}类别`}>
          <div className="entry-section-heading"><h3>{directionLabel}类别</h3><span>{categories.length} 类</span></div>
          <div className="entry-category-grid">
            {categories.map(name => <button type="button" key={name} title={name === '债务' ? '收回欠款' : name} aria-pressed={category === name} onClick={() => {
              if (!initial && direction === 'income' && name === '债务' && onDebt) { onDebt(); return; }
              setCategory(name); setStep(2); setError('');
            }}>
              <span className={`entry-category-icon ${categoryTone(name)}`}><CategoryIcon category={name} size={25} /></span><span>{name}</span>
              {category === name && <Check size={12} className="entry-category-check" />}
            </button>)}
          </div>
        </section>
      </>}
      {step === 2 && <form className="entry-details" onSubmit={submit}>
        <fieldset className="entry-scroll entry-fields" disabled={busy}>
          <button type="button" className="entry-selected-category" onClick={() => setStep(1)} aria-label="更换类别">
            <span className={`entry-category-icon ${categoryTone(category)}`}><CategoryIcon category={category || '其他'} size={25} /></span>
            <span><small>{directionLabel}</small><strong>{category || '其他'}</strong></span><ChevronRight size={20} />
          </button>
          <label className="entry-amount">金额（元）<input name="amount" type="number" inputMode="decimal" min=".01" max="1000000" step=".01" placeholder="0.00" value={fields.amount} onChange={update} required /></label>
          <label>备注<input name="title" placeholder={direction === 'income' ? '这笔收入来自哪里' : '这笔钱花在哪里'} maxLength={160} value={fields.title} onChange={update} /></label>
          <label>记录日期<DateInput name="date" type="date" required value={fields.date} onChange={update} /></label>
          {initial?.status === 'pending' && <div className="confirmation-note"><ShieldCheck size={16} />确认后才会正式保存</div>}
          {error && <div className="error-box" role="alert">{error}</div>}
        </fieldset>
        <div className="entry-actions">
          {initial?.status === 'pending' && <button type="submit" value="draft" className="secondary" disabled={busy}>保存草稿</button>}
          <button type="submit" value="confirm" className="primary" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}{initial?.status === 'pending' ? '确认保存' : '保存'}</button>
        </div>
      </form>}
    </div>
  </Modal>;
}
