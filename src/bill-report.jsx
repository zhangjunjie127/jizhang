import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { billPeriods } from '../shared/ledger.mjs';
import { money } from './ledger-rows';
import './bill-report.css';
import { usePreferences } from './app-preferences';

const exact = cents => `${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`;
function Amount({ cents, className = '', hidden = false }) {
  if (hidden) return <span className={`bill-money ${className}`} aria-label="金额已隐藏">****</span>;
  return <span className={`bill-money ${className}`} title={exact(cents)} aria-label={exact(cents)}>{money(cents)}</span>;
}

export function BillReport({ records, mode, year, onYearChange, onOpenYear, onOpenMonth }) {
  const { preferences } = usePreferences();
  const periods = billPeriods(records);
  const yearOptions = [...new Set([year, ...periods.years.map(item => item.period)])].sort((a, b) => b.localeCompare(a));
  const selectedYear = periods.years.find(item => item.period === year) || { income: 0, expense: 0, net: 0 };
  const summary = mode === 'year' ? periods.total : selectedYear;
  const prefix = mode === 'year' ? '总' : '年';
  const rows = mode === 'year' ? periods.years : periods.months.filter(item => item.period.startsWith(`${year}-`));
  function openPeriod(period) {
    if (mode === 'year') onOpenYear(period);
    else onOpenMonth(period);
  }
  return <section className="bill-report" aria-label={mode === 'year' ? '年账单汇总' : '月账单汇总'}>
    <div className="ledger-head ledger-overview">
    <div className="bill-period-line ledger-toolbar">
      {mode === 'month' ? <label className="bill-year"><select aria-label="选择账单年份" value={year} onChange={event => onYearChange(event.target.value)}>
        {yearOptions.map(value => <option key={value} value={value}>{value}年</option>)}
      </select><ChevronDown size={15} /></label> : <span>全部年份</span>}
      <span>单位：元</span>
    </div>
    <section className="bill-summary ledger-summary" aria-label="账单收支汇总">
      <div className="bill-summary-net summary-expense"><strong style={{ fontSize: preferences.hideTotals ? 38 : money(summary.net).length > 7 ? 20 : money(summary.net).length > 5 ? 24 : 38 }}><Amount cents={summary.net} hidden={preferences.hideTotals} /></strong><span>{prefix}结余 / 元</span></div>
      <div className="summary-income"><span>{prefix}收入 / 元</span><strong><Amount cents={summary.income} hidden={preferences.hideTotals} /></strong></div>
      <div className="summary-average"><span>{prefix}支出 / 元</span><strong><Amount cents={summary.expense} hidden={preferences.hideTotals} /></strong></div>
    </section>
    </div>
    <div className="bill-list-scroll" tabIndex={0} aria-label="账单列表">
    <table className={`bill-table bill-table-${mode}`} aria-label={mode === 'year' ? '各年收支' : '各月收支'}>
      <colgroup><col className="bill-period-column" /><col /><col /><col /><col className="bill-arrow-column" /></colgroup>
      <thead><tr>{[mode === 'year' ? '年份' : '月份', `${mode === 'year' ? '年' : '月'}收入`, `${mode === 'year' ? '年' : '月'}支出`, `${mode === 'year' ? '年' : '月'}结余`].map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col" aria-label="查看明细" /></tr></thead>
      <tbody>{!rows.length && <tr><td colSpan={5} className="bill-table-empty">该年暂无收支记录</td></tr>}{rows.map(row => <tr key={row.period} onClick={() => openPeriod(row.period)}>
        <th scope="row"><button aria-label={`查看${row.period}${mode === 'year' ? '年各月账单' : '月明细'}`} onClick={event => { event.stopPropagation(); openPeriod(row.period); }}>{mode === 'year' ? `${row.period}年` : `${Number(row.period.slice(5))}月`}</button></th>
        <td><Amount cents={row.income} /></td><td><Amount cents={row.expense} /></td><td><Amount cents={row.net} /></td>
        <td><ChevronRight size={15} aria-hidden="true" /></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
