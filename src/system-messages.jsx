import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { getBase, request } from './api';
import { systemMessages } from './system-messages.mjs';
import './system-messages.css';

export function SystemMessages({ userId, onBack }) {
  const storageKey = `zaizai-system-read:${getBase()}:${userId}`;
  const [read, setRead] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
    } catch { return []; }
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([
      request('/feedback', { signal: controller.signal }),
      request('/account/deletion', { signal: controller.signal }),
    ]).then(([feedback, deletion]) => {
      if (!controller.signal.aborted) setItems(systemMessages(feedback.items, deletion.application));
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message || '消息加载失败');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  function markRead(ids) {
    const next = [...new Set([...read, ...ids])];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setRead(next);
    } catch { setError('无法保存已读状态，请检查设备存储空间'); }
  }
  const unread = items.filter(item => !read.includes(item.id));
  return <main className="system-messages-page">
    <header className="system-messages-heading">
      <button className="icon-button" aria-label="返回我的" title="返回我的" onClick={onBack}><ArrowLeft size={21} /></button>
      <h1>消息</h1>
      <button className="icon-button" aria-label="刷新消息" title="刷新消息" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={20} /></button>
    </header>
    <div className="system-messages-toolbar"><h2>系统通知</h2><button className="icon-button" aria-label="全部标为已读" title="全部标为已读" disabled={loading || !unread.length} onClick={() => markRead(unread.map(item => item.id))}><CheckCheck size={20} /></button></div>
    <section className="system-messages-list" aria-label="系统消息" aria-busy={loading}>
      {error && <div className="system-messages-error" role="alert">{error}<button onClick={() => setReload(value => value + 1)}>重试</button></div>}
      {loading && <p className="system-messages-empty" role="status">加载中…</p>}
      {!loading && !error && !items.length && <div className="system-messages-empty"><Bell size={30} /><p>暂无系统消息</p></div>}
      {!loading && items.map(item => <button type="button" className="system-message" key={item.id} aria-label={`${item.title}，${read.includes(item.id) ? '已读' : '未读'}`} onClick={() => markRead([item.id])}>
        <span className="system-message-icon"><Bell size={19} />{!read.includes(item.id) && <i aria-hidden="true" />}</span>
        <span className="system-message-body"><strong>{item.title}</strong><time dateTime={item.created}>{new Date(item.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time><span>{item.text}</span></span>
      </button>)}
    </section>
  </main>;
}
