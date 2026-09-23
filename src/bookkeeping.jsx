import { DateInput } from './date-picker';
import React, { useState } from 'react';
import { Download, Trash2, Wallet, Check, LoaderCircle, X, ChartSpline, List, ChevronDown, ChevronRight } from 'lucide-react';
import { filterLedger, summarizeLedger, ledgerPeriodDays, ledgerCategory } from '../shared/ledger.mjs';
import { exportLedger } from './api';
import { CATEGORIES, CategoryIcon, categoryTone } from './categories';
import { BillReport } from './bill-report';
import { DebtManager } from './debts';
import { CalculatorTools } from './calculator-tools';
import { LedgerDatePicker } from './ledger-date-picker';
import { LedgerRows, money } from './ledger-rows';
import { usePreferences } from './app-preferences';
export { CATEGORIES, CategoryIcon } from './categories';

const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);

export function Ledger({ records, userId, pending, onEdit, onDelete, onTrash, onError, onNotify, onDebtChange, view, setView, debtCreateSignal }) {
  const { preferences } = usePreferences();
  const [filters, setFilters] = useState({ month: currentMonth(), date: preferences.calendarScope === 'today' ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) : '', category: '', direction: '' });
  const [statistics, setStatistics] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportYear, setReportYear] = useState(() => currentMonth().slice(0, 4));
  const [debtBusy, setDebtBusy] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState({});
  const canCollapseDays = view === 'details' && filters.month.length === 7 && !filters.date;
  const yearly = filters.month.length === 4;
  const filtered = filterLedger(records, filters);
  const totals = summarizeLedger(filtered);
  const averageDays = filters.date ? 1 : ledgerPeriodDays(records, filters.month);
  const expenseText = preferences.hideTotals ? '****' : money(totals.expense);
  const incomeText = preferences.hideTotals ? '****' : money(totals.income);
  const averageText = preferences.hideTotals ? '****' : money(Math.round(totals.expense / averageDays));
  const monthTotals = summarizeLedger(filterLedger(records, { month: filters.month }));
  const categories = [...new Set([...CATEGORIES.filter(name => name !== '收回借款'), ...records.filter(r => r.kind === 'expense').map(r => ledgerCategory(r.payload))])];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const yesterday = new Date(Date.parse(`${today}T12:00:00+08:00`) - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const days = new Map();
  for (const record of filtered) {
    if (!days.has(record.payload.date)) days.set(record.payload.date, []);
    days.get(record.payload.date).push(record);
  }
  const activeFilters = Boolean(filters.date || filters.category || filters.direction);
  const extraFilterCount = Number(Boolean(filters.category)) + Number(Boolean(filters.direction));
  const periodLabel = filters.date ? '当日' : yearly ? '本年' : '当月';
  const update = (key, value) => {
    setFilters(previous => ({ ...previous, [key]: value }));
  };
  async function download() {
    setExporting(true);
    try { if (await exportLedger(filters)) onNotify('账本已导出'); }
    catch (error) { onError(error.message); }
    finally { setExporting(false); }
  }
  return <section className="ledger" aria-label="账本">
    <div className="ledger-section-tabs" role="tablist" aria-label="账单视图">
      {[['details', '明细'], ['month', '月账单'], ['year', '年账单'], ['debt', '债务'], ['tools', '工具箱']].map(([value, label]) => <button
        key={value} id={`ledger-tab-${value}`} role="tab" aria-selected={view === value} aria-controls="ledger-view-panel"
        disabled={debtBusy && value !== view}
        onClick={() => { setView(value); if (value === 'details') setStatistics(false); }}>{label}</button>)}
    </div>
    <div id="ledger-view-panel" role="tabpanel" aria-labelledby={`ledger-tab-${view}`}>
    {view === 'tools' ? <CalculatorTools userId={userId} records={records} /> : view === 'debt' ? <DebtManager inline createSignal={debtCreateSignal} onChange={onDebtChange} onBusyChange={setDebtBusy} /> : view !== 'details' ? <BillReport mode={view} year={reportYear} onYearChange={setReportYear} records={records}
      onOpenYear={year => { setReportYear(year); setView('month'); window.scrollTo({ top: 0 }); }}
      onOpenMonth={month => { setFilters({ month, date: '', category: '', direction: '' }); setStatistics(false); setView('details'); window.scrollTo({ top: 0 }); }} /> : <>
    <div className="ledger-head ledger-overview"><div className="ledger-toolbar">
      <span className="muted small">{filters.month} · {filtered.length} 笔</span>
      <div className="ledger-tools">
        <button className="icon-button" aria-label={statistics ? '查看账目明细' : '支出分类统计'} title={statistics ? '查看账目明细' : '支出分类统计'} aria-pressed={statistics} onClick={() => setStatistics(value => !value)}>{statistics ? <List size={20} /> : <ChartSpline size={20} />}</button>
        <button className="icon-button" aria-label="导出筛选账目" title="导出筛选账目（CSV）" disabled={exporting || !filtered.length} onClick={download}>{exporting ? <LoaderCircle size={20} className="spin" /> : <Download size={20} />}</button>
        <button className="icon-button" aria-label="账目回收站" title="账目回收站" onClick={onTrash}><Trash2 size={20} /></button>
      </div>
    </div>
    <div className="ledger-summary" aria-label="筛选账目汇总">
      <div className="summary-expense"><strong data-testid="ledger-expense" title={preferences.hideTotals ? '金额已隐藏' : `${(totals.expense / 100).toFixed(2)} 元`} style={{ fontSize: expenseText.length > 7 ? 20 : expenseText.length > 5 ? 24 : 38 }}>{expenseText}</strong><span>{periodLabel}支出 / 元{activeFilters ? ' · 已筛选' : ''}</span></div>
      <div className="summary-income"><span>{periodLabel}收入 / 元</span><strong>{incomeText}</strong></div>
      <div className="summary-average" title={`支出总额除以 ${averageDays} 个自然日；本年或本月均截至今天。`}><span>日均支出 / 元</span><strong data-testid="ledger-daily-average">{averageText}</strong></div>
    </div></div>
    {!statistics && <section className="ledger-query" aria-label="账目查询">
      <div className="ledger-query-toolbar">
        <span className="ledger-query-period">{filters.date || `${filters.month} · 整月`}</span>
        <LedgerDatePicker month={filters.month} date={filters.date} today={today}
          onChange={(month, date) => setFilters(previous => ({ ...previous, month, date }))} />
        <button className={`query-filter-toggle ${extraFilterCount ? 'is-active' : ''}`} aria-label="收支与分类筛选" title="收支与分类筛选" aria-expanded={filtersOpen} aria-controls="ledger-extra-filters" onClick={() => setFiltersOpen(value => !value)}><svg viewBox="0 0 1024 1024" width={19} height={19} fill="currentColor" aria-hidden="true" focusable="false"><path d="M256 640h-64V448h288V320h64v128h288v192h-64V512H544v128h-64V512H256v128z m256-384c52.8 0 96-43.2 96-96s-43.2-96-96-96-96 43.2-96 96 43.2 96 96 96z m0 448c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z m-288 0c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z m576 0c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z" /></svg>{extraFilterCount > 0 && <span>{extraFilterCount}</span>}</button>
      </div>
      <div className="ledger-extra-filters" id="ledger-extra-filters">
        <label>收支<select aria-label="筛选收支" value={filters.direction} onChange={e => update('direction', e.target.value)}><option value="">全部收支</option><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label>分类<select aria-label="筛选分类" value={filters.category} onChange={e => update('category', e.target.value)}><option value="">全部分类</option>{categories.map(name => <option key={name}>{name}</option>)}</select></label>
      </div>
      {activeFilters && <div className="query-selected">
        {filters.direction && <button className="query-condition" aria-label="清除收支筛选" onClick={() => update('direction', '')}>{filters.direction === 'income' ? '收入' : '支出'}<X size={12} /></button>}
        {filters.category && <button className="query-condition" aria-label="清除分类筛选" onClick={() => update('category', '')}>{filters.category}<X size={12} /></button>}
        <button className="text-button query-reset" onClick={() => setFilters(p => ({ ...p, date: '', category: '', direction: '' }))}>清除筛选</button>
      </div>}
    </section>}
    <div className="ledger-list-scroll" tabIndex={0} aria-label="账目内容">
    {pending}
    {statistics && <section className="category-breakdown" aria-label="支出分类统计">
      <div className="section-heading"><h2>{filters.month || '全部月份'} · 支出分类</h2></div>
      {monthTotals.categories.length ? monthTotals.categories.map(({ name, cents }) => <button className={`category-line ${categoryTone(name)} ${filters.category === name ? 'selected' : ''}`} key={name} onClick={() => { setFilters(p => ({ ...p, date: '', direction: 'expense', category: name })); setStatistics(false); }} aria-label={`查看${name}支出`}>
        <span className="category-name"><span className="category-symbol"><CategoryIcon category={name} size={18} /></span><span>{name}</span></span><span className="category-bar"><i style={{ width: `${cents / monthTotals.expense * 100}%` }} /></span>
        <span className="category-amount">¥ {money(cents)}<small>{(cents / monthTotals.expense * 100).toFixed(1)}%</small></span>
      </button>) : <div className="empty"><Wallet size={28} /><strong>{yearly ? '本年' : '本月'}还没有支出</strong></div>}
    </section>}
    {!statistics && <section className="record-list" aria-label="账目明细">
      {days.size ? [...days].map(([date, entries]) => {
        const day = summarizeLedger(entries);
        const expanded = !canCollapseDays || !collapsedDays[date];
        return <section className="ledger-day" key={date} aria-label={date === today ? '今天收支' : date === yesterday ? '昨天收支' : date}><div className={`ledger-day-heading${canCollapseDays ? ' is-collapsible' : ''}`}><time dateTime={date}>{[today, yesterday].includes(date) ? <><strong>{date === today ? '今天' : '昨天'}</strong><small>{date}</small></> : date}</time><span className="day-totals"><span>收入 {money(day.income)}</span><span>支出 {money(day.expense)}</span></span>
          {canCollapseDays && <button className="icon-button ledger-day-toggle" aria-label={`${expanded ? '收起' : '展开'}${date}账目`} title={expanded ? '收起当天账目' : '展开当天账目'} aria-expanded={expanded} aria-controls={`ledger-day-${date}`} onClick={() => setCollapsedDays(previous => ({ ...previous, [date]: !previous[date] }))}>{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>}
        </div>
        <div id={`ledger-day-${date}`} hidden={!expanded}>
          {!entries.length && <p className="ledger-day-empty">暂无收支记录</p>}
          <LedgerRows entries={entries} onEdit={onEdit} onDelete={onDelete} />
        </div>
        </section>;
      }) : <div className="empty"><Wallet size={28} /><strong>没有符合条件的账目</strong></div>}
    </section>}</div></>}</div>
  </section>;
}

export function BatchReview({ records, onConfirm, onClose, onReload }) {
  const toRows = records => records.filter(r => r.kind === 'expense' && r.status === 'pending').slice(0, 100).map(r => ({ ...r, selected: true, payload: { ...r.payload } }));
  const [rows, setRows] = useState(() => toRows(records));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = rows.filter(r => r.selected);
  const update = (id, key, value) => setRows(previous => previous.map(r => r.id === id ? { ...r, payload: { ...r.payload, [key]: value } } : r));
  async function confirm(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onConfirm(selected.map(({ id, revision, payload }) => ({ id, revision, payload }))); onClose(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <form className="batch-review" onSubmit={confirm}>
    <label className="batch-select"><input type="checkbox" checked={rows.length > 0 && selected.length === rows.length} disabled={busy || !rows.length} onChange={e => setRows(rows.map(r => ({ ...r, selected: e.target.checked })))} />全选 · {selected.length}/{rows.length} 笔</label>
    {rows.map((record, index) => <section className="batch-row" key={record.id}>
      <label className="batch-select"><input type="checkbox" aria-label={`选择第${index + 1}笔`} checked={record.selected} disabled={busy} onChange={e => setRows(rows.map(r => r.id === record.id ? { ...r, selected: e.target.checked } : r))} />第 {index + 1} 笔</label>
      <fieldset disabled={!record.selected || busy}>
        <div className="form-columns">
          <label>金额（元）<input aria-label={`第${index + 1}笔金额`} type="number" inputMode="decimal" min=".01" max="1000000" step=".01" required value={record.payload.amount} onChange={e => update(record.id, 'amount', e.target.value)} /></label>
          <label>收支<select value={record.payload.direction} onChange={e => update(record.id, 'direction', e.target.value)}><option value="expense">支出</option><option value="income">收入</option></select></label>
        </div>
        <label>备注<input aria-label={`第${index + 1}笔备注`} value={record.payload.title} maxLength={160} onChange={e => update(record.id, 'title', e.target.value)} /></label>
        <div className="form-columns">
          <label>分类<input value={record.payload.category} maxLength={30} required onChange={e => update(record.id, 'category', e.target.value)} /></label>
          <label>日期<DateInput type="date" value={record.payload.date} required onChange={e => update(record.id, 'date', e.target.value)} /></label>
        </div>
      </fieldset>
    </section>)}
    {error && <div className="error-box" role="alert">{error}</div>}
    {error && <button className="text-button" type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const result = await onReload(); setRows(toRows(result.records)); setError(''); }
      catch (error) { setError(error.message); }
      finally { setBusy(false); }
    }}>重新载入草稿（放弃未保存修改）</button>}
    <div className="modal-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
      <button className="primary" disabled={busy || !selected.length}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}确认保存 {selected.length} 笔</button>
    </div>
  </form>;
}
