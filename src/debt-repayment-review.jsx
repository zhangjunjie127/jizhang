import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { request } from './api';
import { debtAmountCents, debtToday } from '../shared/debts.mjs';

const amountText = cents => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DebtRepaymentReview({ Modal, record, onConfirm, onClose, onReload }) {
  const [data, setData] = useState(null);
  const [personId, setPersonId] = useState('');
  const [billId, setBillId] = useState('');
  const [fields, setFields] = useState({ amount: String(record.payload.amount), date: record.payload.date, note: record.payload.note || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const saving = useRef(false);
  const bills = data?.bills.filter(bill => bill.direction === 'receivable' && bill.state === 'open') || [];
  const people = data?.people.filter(person => bills.some(bill => bill.person_id === person.id)) || [];
  const available = bills.filter(bill => bill.person_id === personId);
  const bill = available.find(item => item.id === billId);
  let cents = 0;
  try { cents = debtAmountCents(fields.amount); } catch {}
  useEffect(() => {
    const controller = new AbortController();
    request('/debts', { signal: controller.signal }).then(result => {
      setData(result);
      const person = result.people.find(item => item.name === record.payload.personName);
      if (!person) return;
      const matches = result.bills.filter(item => item.person_id === person.id && item.direction === 'receivable' && item.state === 'open');
      if (matches.length) setPersonId(person.id);
      if (matches.length === 1) setBillId(matches[0].id);
    }).catch(failure => { if (failure.name !== 'AbortError') setError(failure); });
    return () => controller.abort();
  }, [record.id]);
  function choosePerson(id) {
    setPersonId(id);
    const matches = bills.filter(item => item.person_id === id);
    setBillId(matches.length === 1 ? matches[0].id : '');
  }
  async function submit(event) {
    event.preventDefault();
    if (!bill || saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      await onConfirm(record, { ...fields, billId: bill.id, billRevision: bill.revision, revision: record.revision });
    } catch (failure) { setError(failure); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Modal title="核对收到还款" fullScreen onClose={busy ? () => {} : onClose}>
    <form className="debt-manager debt-form" onSubmit={submit}>
      <fieldset className="debt-scroll debt-fields" disabled={busy}>
        <div className="debt-form-context"><strong>{record.payload.personName}还款</strong><span>待确认 · 尚未入账</span></div>
        {!data && !error && <p role="status">正在加载原欠条…</p>}
        {data && <>
          <label>欠款人<select aria-label="还款欠款人" required value={personId} onChange={event => choosePerson(event.target.value)}>
            <option value="">请选择欠款人</option>
            {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <label>原欠条<select aria-label="还款原欠条" required value={billId} onChange={event => setBillId(event.target.value)}>
            <option value="">请选择原欠条</option>
            {available.map(item => <option key={item.id} value={item.id}>{item.loan_date} · 剩余 {amountText(item.balanceCents)} 元 · {item.note || item.id.slice(0, 8)}</option>)}
          </select></label>
          {!people.length && <p className="debt-note">暂无可关联的欠条。请先在债务管理中登记原借款，这条还款草稿会保留。</p>}
          {available.length > 1 && !bill && <p className="debt-note">该欠款人有多张欠条，请选择本次还款对应的一张。</p>}
          <label>本次收到（元）<input type="number" inputMode="decimal" min=".01" max={bill ? bill.balanceCents / 100 : 1000000} step=".01" required value={fields.amount} onChange={event => setFields({ ...fields, amount: event.target.value })} /></label>
          <label>实际还款日期<DateInput type="date" required min={bill?.loan_date} max={debtToday()} value={fields.date} onChange={event => setFields({ ...fields, date: event.target.value })} /></label>
          <label>备注<textarea maxLength={300} rows={2} value={fields.note} onChange={event => setFields({ ...fields, note: event.target.value })} /></label>
          {bill && <dl className="debt-facts">
            <div><dt>原借款</dt><dd>{amountText(bill.principal_cents)} 元</dd></div>
            <div><dt>当前欠款</dt><dd>{amountText(bill.balanceCents)} 元</dd></div>
            <div><dt>约定还款日不变</dt><dd>{bill.due_date || '未约定'}</dd></div>
            {cents > 0 && cents <= bill.balanceCents && <>
              <div><dt>新增收入 · 债务</dt><dd>{amountText(cents)} 元</dd></div>
              <div><dt>还款后剩余</dt><dd>{amountText(bill.balanceCents - cents)} 元</dd></div>
            </>}
          </dl>}
        </>}
        {error && <div className="error-box" role="alert">{error.message}</div>}
        {error && <button className="text-button" type="button" onClick={onReload}>刷新后重新核对</button>}
      </fieldset>
      <div className="debt-actions"><button className="primary" type="submit" disabled={busy || !bill}>
        {busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}确认还款并记收入
      </button></div>
    </form>
  </Modal>;
}
