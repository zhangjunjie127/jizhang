import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { Plus, ChevronRight, Users, Search, Check, LoaderCircle, Pencil, Undo2, Trash2, ArrowDownLeft, ArrowUpRight, ArrowLeft } from 'lucide-react';
import { request } from './api';
import { requestId } from './navigation';
import { debtToday, debtTimeline, groupDebts } from '../shared/debts.mjs';
import { PreviewKeyboard } from './preview-keyboard';
import './debts.css';

const exact = cents => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = cents => cents >= 1000000 ? `${(cents / 1000000).toFixed(2)}万` : exact(cents);
const STATUS = { open: '未结清', settled: '已结清', voided: '已作废' };
const empty = { people: [], bills: [], payments: [] };
const DebtAmount = ({ cents, full = false }) => <span className="debt-amount" title={`${exact(cents)} 元`}>{full ? exact(cents) : compact(cents)}</span>;

export function DebtManager({ Modal, onClose, onChange, initialBillId, receivableOnly = false, inline = false, onBusyChange, createSignal = 0 }) {
  const inlineRef = useRef(null);
  const lastCreateSignal = useRef(createSignal);
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [screen, setScreen] = useState(initialBillId ? { type: 'bill', billId: initialBillId } : { type: 'list' });
  const [direction, setDirection] = useState('receivable');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(receivableOnly ? 'open' : 'all');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (lastCreateSignal.current === createSignal) return;
    lastCreateSignal.current = createSignal;
    if (!inline || busy || loading || loadError) return;
    setScreen(previous => ['list', 'person', 'bill'].includes(previous.type)
      ? { type: 'new', personId: previous.personId || data.bills.find(item => item.id === previous.billId)?.person_id, returnTo: previous }
      : previous);
  }, [createSignal, inline, busy, loading, loadError, data.bills]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (inline && screen.type !== 'list') window.scrollTo({ top: 0 }); }, [inline, screen]);
  const person = data.people.find(item => item.id === screen.personId);
  const bill = data.bills.find(item => item.id === screen.billId);
  const counterpart = data.people.find(item => item.id === bill?.person_id);
  const totals = data.bills.reduce((sum, item) => {
    sum[item.direction] += item.balanceCents;
    return sum;
  }, { receivable: 0, payable: 0 });
  const summaryAmountLength = Math.max(compact(totals.receivable).length, compact(totals.payable).length);
  const summaryAmountSize = summaryAmountLength > 7 ? 20 : summaryAmountLength > 5 ? 24 : 38;
  const groups = groupDebts(data.people, data.bills, direction, filter === 'voided')
    .map(group => ({ ...group, visibleBills: group.bills.filter(item => filter === 'all' ? item.state !== 'voided' : item.state === filter) }))
    .filter(group => group.visibleBills.length && group.name.includes(search.trim()));
  async function load(signal) {
    setLoadError('');
    setLoading(true);
    try { setData(await request('/debts', { signal })); }
    catch (error) { if (error.name !== 'AbortError') setLoadError(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);
  function back() {
    if (screen.type === 'person') setScreen({ type: 'list' });
    else if (screen.type === 'bill') setScreen({ type: 'person', personId: bill.person_id });
    else if (screen.type === 'new') setScreen(screen.returnTo || { type: 'list' });
    else setScreen({ type: 'bill', billId: screen.billId });
  }
  function newBill(personId) {
    setScreen({ type: 'new', personId, returnTo: screen });
  }
  async function save(path, body, method = 'POST') {
    const result = await request(path, { method, body });
    setData(result);
    if (result.ledgerState) onChange?.(result.ledgerState);
    setScreen({ type: 'bill', billId: result.billId || screen.billId });
  }
  const titles = { list: receivableOnly ? '收回欠款' : '债务往来', person: person?.name || '往来账单', bill: '借款详情', new: '新增借款', payment: '登记还款', edit: '修改资料', voidBill: '作废账单', voidPayment: '撤销还款' };
  const directionTabs = <div className="debt-direction" role="group" aria-label="借款方向">
    <button type="button" aria-pressed={direction === 'receivable'} onClick={() => setDirection('receivable')}>别人欠我</button>
    <button type="button" aria-pressed={direction === 'payable'} onClick={() => setDirection('payable')}>我欠别人</button>
  </div>;
  function personBills(id) {
    return data.bills.filter(item => item.person_id === id && item.direction === direction && (filter === 'all' ? item.state !== 'voided' : item.state === filter));
  }
  function latestPayment(item) {
    return debtTimeline(item, data.payments).filter(payment => !payment.voided_at).at(-1);
  }
  const recentPayment = bill ? latestPayment(bill) : null;
  const content = <div className="debt-manager">
      {loading ? <div className="debt-empty" role="status"><LoaderCircle size={24} className="spin" />正在加载</div>
        : loadError ? <div className="debt-empty"><p role="alert">{loadError}</p><button className="secondary" onClick={() => load()}>重试</button></div>
        : <>
          {['list', 'person'].includes(screen.type) && <>
            <div className="debt-scroll">
              {!(inline && screen.type === 'list') && <div className="debt-totals" aria-label={screen.type === 'list' ? '全部债务汇总' : '往来人债务汇总'}>
                {(receivableOnly ? ['receivable'] : ['receivable', 'payable']).map(value => {
                  const total = screen.type === 'list' ? totals[value] : data.bills.filter(item => item.person_id === person.id && item.direction === value).reduce((sum, item) => sum + item.balanceCents, 0);
                  return <div key={value}><span>{value === 'receivable' ? '待收回 / 元' : '待归还 / 元'}</span><strong><DebtAmount cents={total} /></strong></div>;
                })}
              </div>}
              {!receivableOnly && directionTabs}
              <div className="debt-filters">
                {screen.type === 'list' && <label className="debt-search"><Search size={17} /><input aria-label="搜索往来人" placeholder="搜索姓名" value={search} onChange={event => setSearch(event.target.value)} /></label>}
                <label className="debt-status-filter"><span>状态</span><select aria-label="债务状态" value={filter} onChange={event => setFilter(event.target.value)}>
                  <option value="all">全部有效</option><option value="open">未结清</option><option value="settled">已结清</option><option value="voided">已作废</option>
                </select></label>
              </div>
              {screen.type === 'list' ? <section aria-label="按人汇总债务">
                {groups.length ? groups.map(group => <button className="debt-person-row" key={group.id} onClick={() => setScreen({ type: 'person', personId: group.id })} aria-label={`查看${group.name}的账单`}>
                  <span className="debt-person-avatar"><Users size={21} /></span>
                  <span className="debt-row-main"><strong>{group.name}</strong><small>{group.visibleBills.length} 张账单</small></span>
                  <span className="debt-row-total"><DebtAmount cents={group.visibleBills.reduce((sum, item) => sum + item.balanceCents, 0)} /><small>{direction === 'receivable' ? '合计待收' : '合计待还'}</small></span><ChevronRight size={17} />
                </button>) : <div className="debt-empty"><Users size={28} /><p>{search ? '没有匹配的往来人' : '暂无这类借款记录'}</p></div>}
              </section> : <section aria-label="独立借款账单">
                {personBills(person.id).length ? personBills(person.id).map(item => {
                  const recent = latestPayment(item);
                  return <button key={item.id} className="debt-bill-row" aria-label={`查看借款 ${item.id.slice(0, 8)}`} onClick={() => setScreen({ type: 'bill', billId: item.id })}>
                  <div className="debt-row-heading"><strong>{item.loan_date}</strong><span className={`debt-badge ${item.state}`}>{STATUS[item.state]}</span></div>
                  <p>{item.note || (direction === 'receivable' ? '借给对方' : '向对方借款')}</p>
                  <div className="debt-bill-numbers"><span>原借款 <DebtAmount cents={item.principal_cents} /></span><strong>剩余 <DebtAmount cents={item.balanceCents} /></strong></div>
                  {recent && <div className="debt-bill-repayment"><span>最近还款 <time dateTime={recent.date}>{recent.date}</time></span><span>金额 <DebtAmount cents={recent.cents} /> 元</span></div>}
                  <small>单号 {item.id.slice(0, 8)}{item.due_date ? ` · 约定 ${item.due_date}` : ''}{item.state === 'open' && item.due_date && item.due_date < debtToday() ? ' · 已逾期' : ''}</small>
                </button>;
                }) : <div className="debt-empty"><p>暂无这类借款账单</p></div>}
              </section>}
            </div>
            {!inline && <div className="debt-actions"><button className="primary" onClick={() => newBill(person?.id)}><Plus size={18} />新增借款</button></div>}
          </>}
          {screen.type === 'bill' && bill && <>
            <div className="debt-scroll">
              <div className="debt-bill-header"><div><small>{bill.direction === 'receivable' ? '别人欠我' : '我欠别人'}</small><h3>{counterpart.name}</h3></div><span className={`debt-badge ${bill.state}`}>{STATUS[bill.state]}</span></div>
              <div className="debt-balance"><span>剩余欠款 / 元</span><strong><DebtAmount cents={bill.balanceCents} full /></strong></div>
              <dl className="debt-facts">
                <div><dt>原借款</dt><dd><DebtAmount cents={bill.principal_cents} full /> 元</dd></div>
                <div><dt>累计已还</dt><dd><DebtAmount cents={bill.paidCents} full /> 元</dd></div>
                <div><dt>借款日期</dt><dd>{bill.loan_date}</dd></div>
                <div><dt>约定还款日</dt><dd>{bill.due_date || '未约定'}</dd></div>
                <div><dt>最近还款日</dt><dd>{recentPayment ? <time dateTime={recentPayment.date}>{recentPayment.date}</time> : '尚未还款'}</dd></div>
                <div><dt>单号</dt><dd>{bill.id.slice(0, 8)}</dd></div>
              </dl>
              {bill.note && <p className="debt-note">{bill.note}</p>}
              {bill.voided_at && <p className="debt-note">已作废：{bill.void_reason}<small>{new Date(bill.voided_at).toLocaleString('zh-CN')}</small></p>}
              {!bill.voided_at && <div className="debt-detail-tools"><button className="text-button" onClick={() => setScreen({ type: 'edit', billId: bill.id })}><Pencil size={15} />修改资料</button>
                {bill.paidCents === 0 && <button className="text-button danger" onClick={() => setScreen({ type: 'voidBill', billId: bill.id })}><Trash2 size={15} />作废账单</button>}</div>}
              <section className="debt-history" aria-label="借还明细">
                <h3>借还明细</h3>
                <div className="debt-event"><span className="debt-event-icon">{bill.direction === 'receivable' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</span><div className="debt-event-main"><strong>{bill.direction === 'receivable' ? '借出' : '借入'} <DebtAmount cents={bill.principal_cents} full /></strong><time>{bill.loan_date}</time><small>借款余额 <DebtAmount cents={bill.principal_cents} full /></small></div></div>
                {debtTimeline(bill, data.payments).map(payment => <div className={`debt-event ${payment.voided_at ? 'is-void' : ''}`} key={payment.id}>
                  <span className="debt-event-icon"><Check size={18} /></span>
                  <div className="debt-event-main"><strong>{bill.direction === 'receivable' ? '收到还款' : '归还借款'} <DebtAmount cents={payment.cents} full /></strong><time dateTime={payment.date}>实际还款日期 {payment.date}</time>
                    {bill.due_date && payment.date < bill.due_date && <small>提前还款</small>}
                    {payment.note && <p>{payment.note}</p>}
                    {payment.voided_at ? <small>已撤销：{payment.void_reason}<br />{new Date(payment.voided_at).toLocaleString('zh-CN')}</small>
                      : <small>还款后余额 <DebtAmount cents={payment.balanceCents} full /></small>}
                    {payment.ledger_record_id && <small>{payment.voided_at ? '对应收入已撤销' : '已记收入 · 债务（收回欠款）'}</small>}
                  </div>
                  {!payment.voided_at && !bill.voided_at && <button className="icon-button" aria-label={`撤销还款 ${payment.id.slice(0, 8)}`} title="撤销这笔还款" onClick={() => setScreen({ type: 'voidPayment', billId: bill.id, paymentId: payment.id })}><Undo2 size={17} /></button>}
                </div>)}
              </section>
            </div>
            <div className="debt-actions">{bill.state === 'open' ? <button className="primary" onClick={() => setScreen({ type: 'payment', billId: bill.id })}><Plus size={18} />登记还款</button>
              : <button className="secondary" onClick={() => newBill(bill.person_id)}><Plus size={18} />新增借款</button>}</div>
          </>}
          {['new', 'payment', 'edit', 'voidBill', 'voidPayment'].includes(screen.type) && <DebtForm key={`${screen.type}-${screen.billId || ''}`}
            type={screen.type} person={person || counterpart} people={data.people} bill={bill} direction={direction} busy={busy} setBusy={setBusy} receivableOnly={receivableOnly}
            payment={data.payments.find(item => item.id === screen.paymentId)}
            onReload={async () => { await load(); setScreen({ type: 'bill', billId: screen.billId }); }}
            onSave={body => screen.type === 'new' ? save('/debts', body)
              : screen.type === 'payment' ? save(`/debts/${bill.id}/payments`, body)
              : screen.type === 'edit' ? save(`/debts/${bill.id}`, body, 'PATCH')
              : screen.type === 'voidBill' ? save(`/debts/${bill.id}/void`, body)
              : save(`/debts/${bill.id}/payments/${screen.paymentId}/void`, body)} />}
        </>}
    </div>;
  return inline ? <section className={`debt-inline${screen.type === 'list' ? ' debt-inline-list' : ''}`} aria-label="债务管理" ref={inlineRef}>
    {screen.type === 'list' && <div className="ledger-head ledger-overview">
      <div className="ledger-toolbar"><span className="muted small">债务往来 · {loading ? '加载中' : loadError ? '加载失败' : `${data.bills.filter(item => item.state !== 'voided').length} 笔`}</span><span className="muted small debt-open-count">未结清 / 笔 {loading || loadError ? '--' : data.bills.filter(item => item.state === 'open').length}</span></div>
      <div className="ledger-summary" aria-label="全部债务汇总" aria-busy={loading}>
        <div className="summary-expense"><strong style={{ fontSize: summaryAmountSize }}>{loading || loadError ? '--' : <DebtAmount cents={totals.receivable} />}</strong><span>待收回 / 元</span></div>
        <div className="debt-summary-payable"><strong style={{ fontSize: summaryAmountSize }}>{loading || loadError ? '--' : <DebtAmount cents={totals.payable} />}</strong><span>待归还 / 元</span></div>
      </div>
    </div>}
    {screen.type !== 'list' && <header className="debt-inline-heading">
      <button className="icon-button" aria-label="返回债务上一级" title="返回上一级" disabled={busy || loading} onClick={back}><ArrowLeft size={20} /></button>
      <h2>{titles[screen.type]}</h2>
    </header>}
    {content}
    <PreviewKeyboard key={`${screen.type}-${screen.billId || ''}`} dialogRef={inlineRef} />
  </section> : <Modal title={titles[screen.type]} fullScreen onClose={busy ? () => {} : onClose} onBack={screen.type !== 'list' && !busy ? back : undefined}>{content}</Modal>;
}

function DebtForm({ type, person, people, bill, payment, direction, busy, setBusy, onSave, onReload, receivableOnly }) {
  const [fields, setFields] = useState({
    personName: person?.name || '', direction, amount: '', date: debtToday(),
    dueDate: type === 'edit' ? bill.due_date || '' : '', note: type === 'edit' ? bill.note : '', reason: '',
  });
  const [error, setError] = useState(null);
  const key = useRef(requestId());
  const saving = useRef(false);
  const change = event => setFields(previous => ({ ...previous, [event.target.name]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { await onSave({ ...fields, revision: bill?.revision, requestId: key.current }); }
    catch (failure) { setError(failure); }
    finally { saving.current = false; setBusy(false); }
  }
  const isVoid = type === 'voidBill' || type === 'voidPayment';
  const createsIncome = type === 'payment' && bill.direction === 'receivable';
  const paymentCents = Math.round(Number(fields.amount) * 100);
  return <form className="debt-form" onSubmit={submit}>
    <fieldset className="debt-scroll debt-fields" disabled={busy}>
      {type === 'new' ? <>
        {!receivableOnly && <div className="debt-direction" role="group" aria-label="新借款方向">{['receivable', 'payable'].map(value => <button type="button" key={value} aria-pressed={fields.direction === value} onClick={() => setFields(previous => ({ ...previous, direction: value }))}>{value === 'receivable' ? '我借出' : '我借入'}</button>)}</div>}
        <label>对方姓名<input name="personName" list="debt-people" value={fields.personName} onChange={change} maxLength={40} required placeholder="姓名或区分同名的称呼" /></label>
        <datalist id="debt-people">{people.map(item => <option key={item.id} value={item.name} />)}</datalist>
      </> : <div className="debt-form-context"><strong>{person.name}</strong><span>{bill.direction === 'receivable' ? '别人欠我' : '我欠别人'} · {bill.loan_date}</span><span>当前欠款 <DebtAmount cents={bill.balanceCents} full /> 元</span><span>约定还款日：{bill.due_date || '未约定'}</span></div>}
      {isVoid ? <label>{type === 'voidBill' ? '作废原因' : '撤销原因'}<textarea name="reason" value={fields.reason} onChange={change} maxLength={300} required rows={3} /></label> : <>
        {type !== 'edit' && <>
          <label>{type === 'new' ? '借款金额（元）' : '本次还款（元）'}<input name="amount" type="number" inputMode="decimal" min=".01" max={type === 'payment' ? bill.balanceCents / 100 : 1000000} step=".01" placeholder="0.00" value={fields.amount} onChange={change} required /></label>
          <label>{type === 'new' ? '借款日期' : '实际还款日期'}<DateInput name="date" type="date" value={fields.date} min={type === 'payment' ? bill.loan_date : undefined} max={debtToday()} onChange={change} required /></label>
        </>}
        {type !== 'payment' && <label>约定还款日（选填）<DateInput name="dueDate" type="date" min={type === 'new' ? fields.date : bill.loan_date} value={fields.dueDate} onChange={change} /></label>}
        <label>备注<textarea name="note" value={fields.note} onChange={change} rows={3} maxLength={300} /></label>
      </>}
      {type === 'payment' && paymentCents > 0 && paymentCents <= bill.balanceCents && <dl className="debt-facts">
        {createsIncome && <div><dt>同步记入收入</dt><dd><DebtAmount cents={paymentCents} full /> 元</dd></div>}
        <div><dt>还款后剩余</dt><dd><DebtAmount cents={bill.balanceCents - paymentCents} full /> 元</dd></div>
        <div><dt>约定还款日不变</dt><dd>{bill.due_date || '未约定'}</dd></div>
      </dl>}
      {type === 'voidPayment' && payment?.ledger_record_id && <p className="debt-note">同时撤销对应收入 <DebtAmount cents={payment.cents} full /> 元，欠款余额将恢复。</p>}
      {error && <div className="error-box" role="alert">{error.message}</div>}
      {error?.status === 409 && bill && <button type="button" className="text-button" onClick={onReload}>刷新账单，重新核对</button>}
    </fieldset>
    <div className="debt-actions"><button type="submit" className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}{type === 'new' ? '确认保存借款' : type === 'payment' ? createsIncome ? '确认还款并记收入' : '确认记录还款' : type === 'edit' ? '保存修改' : type === 'voidBill' ? '确认作废' : '确认撤销'}</button></div>
  </form>;
}
