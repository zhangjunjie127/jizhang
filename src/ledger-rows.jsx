import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Trash2, X, Pencil } from 'lucide-react';
import { ledgerCategory } from '../shared/ledger.mjs';
import { CategoryIcon, categoryTone } from './categories';
import { usePreferences } from './app-preferences';

export const money = cents => `${(cents / (Math.abs(cents) >= 1000000 ? 1000000 : 100)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${Math.abs(cents) >= 1000000 ? '万' : ''}`;

export function LedgerRows({ entries, onEdit, onDelete }) {
  const { preferences } = usePreferences();
  const [selected, setSelected] = useState(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  function close() { dialog.current?.close(); setSelected(null); trigger.current?.focus(); }
  return <>{entries.map(record => {
    const category = ledgerCategory(record.payload);
    const linked = record.source === 'debt-repayment';
    return <div className="ledger-row" data-record-id={record.id} key={record.id}>
      <button className="ledger-entry" aria-label={`${linked ? '查看还款' : preferences.quickEdit ? '修改' : '查看'}${record.payload.title}`} title={linked ? '查看原欠条及还款明细' : preferences.quickEdit ? '查看并修改账目' : '查看账目详情'} onClick={event => {
        if (linked || preferences.quickEdit) onEdit(record);
        else { trigger.current = event.currentTarget; setSelected(record); }
      }}>
        <span className={`record-icon ${categoryTone(category)}`}><CategoryIcon category={category} /></span>
        <span className="row-main"><strong>{record.payload.title}</strong><small>{category}{linked ? ' · 收回欠款' : ''}{record.payload.receipt ? ` · 小票 · ${record.payload.receipt.items.length} 项商品` : ''}</small></span>
        <strong className={`ledger-amount ${record.payload.direction === 'income' ? 'income' : ''}`}>{record.payload.direction === 'income' ? '+' : '-'}{money(record.payload.cents)}</strong>
      </button>
      {linked
        ? <button className="icon-button ledger-delete" aria-label={`查看原欠条${record.payload.title}`} title="查看原欠条" onClick={() => onEdit(record)}><ChevronRight size={16} /></button>
        : <button className="icon-button ledger-delete" aria-label={`删除${record.payload.title}`} title="删除账目" onClick={() => onDelete(record)}><Trash2 size={16} /></button>}
    </div>;
  })}{selected && <dialog ref={dialog} className="ledger-readonly-dialog" aria-label="账目详情" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <header><h2>账目详情</h2><button className="icon-button" aria-label="关闭账目详情" onClick={close}><X size={20} /></button></header>
    <dl>{[['备注', selected.payload.title || '无'], ['类别', ledgerCategory(selected.payload)], ['日期', selected.payload.date], ['金额', `${selected.payload.direction === 'income' ? '+' : '-'}${(selected.payload.cents / 100).toFixed(2)} 元`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <button className="primary" onClick={() => { const record = selected; close(); onEdit(record); }}><Pencil size={18} />编辑账目</button>
  </dialog>}</>;
}
