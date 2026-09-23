import React, { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ArrowLeft, ListChecks, CalendarDays, RefreshCw, Plus } from 'lucide-react';
import { request, getToken } from './api';
import { defaultWidgetSettings, widgetSnapshot } from '../shared/widgets.mjs';
import './desktop-widgets.css';

const Widgets = registerPlugin('DesktopWidgets');
let syncGeneration = 0;
const key = userId => `zaizai-widgets-${userId}`;
function settingsFor(userId) {
  try { return { ...defaultWidgetSettings(), ...JSON.parse(localStorage.getItem(key(userId)) || '{}') }; }
  catch { return defaultWidgetSettings(); }
}
const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
const shanghaiDate = timestamp => new Date(timestamp + 8 * 3600000);
const dateKey = date => date.toISOString().slice(0, 10);
const dateLabel = date => `${date.slice(5, 10)} 周${weekdayNames[new Date(`${date}T00:00:00+08:00`).getUTCDay()]}`;
function previewRows(snapshot, settings) {
  if (!snapshot || !settings.showContent) return [];
  return (snapshot.agenda?.rows || []).filter(row => {
    if (settings.source === 'tasks') return row.kind === 'task' && settings.tasks;
    if (settings.source === 'courses') return row.kind === 'course' && settings.courses;
    return (row.kind === 'task' && settings.tasks) || (row.kind === 'course' && settings.courses);
  });
}
function WidgetPreview({ snapshot, settings }) {
  const rows = previewRows(snapshot, settings);
  const today = snapshot ? dateKey(shanghaiDate(snapshot.updated)) : '';
  if (!settings.showContent) return <div className="widget-empty">内容已隐藏，打开应用查看</div>;
  if (!rows.length) return <div className="widget-empty">{snapshot?.agenda?.message || '暂无关联日程'}</div>;
  if (settings.layout === 'list') return <div className="widget-list-layout"><strong>{dateLabel(today)}</strong>
    {rows.slice(0, 5).map(row => <div className="widget-list-row" key={row.id}><i style={{ background: row.color }} /><span><b>{row.title}</b><small>{row.detail}</small></span></div>)}</div>;
  if (settings.layout === 'month') {
    const current = shanghaiDate(snapshot.updated);
    const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
    const grid = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
      const day = index - offset + 1;
      return day < 1 || day > days ? '' : String(day);
    });
    const marked = new Set(rows.map(row => row.date));
    return <div className="widget-month-layout"><div className="widget-agenda-column"><strong>{dateLabel(today)}</strong>{rows.slice(0, 4).map(row => <div className="widget-list-row" key={row.id}><i style={{ background: row.color }} /><span><b>{row.title}</b><small>{row.detail}</small></span></div>)}</div><div className="widget-month"><strong>{current.getUTCMonth() + 1}月</strong><div className="widget-month-week">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div><div className="widget-month-grid">{grid.map((day, index) => <span className={day && marked.has(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${day.padStart(2, '0')}`) ? 'has-event' : ''} key={index}>{day}</span>)}</div></div></div>;
  }
  const base = new Date(`${today}T00:00:00+08:00`);
  const days = Array.from({ length: 7 }, (_, index) => { const value = new Date(base); value.setUTCDate(value.getUTCDate() + index); return value.toISOString().slice(0, 10); });
  return <div className="widget-week-layout"><div className="widget-week-head">{days.map(date => <span className={date === today ? 'today' : ''} key={date}><b>周{weekdayNames[new Date(`${date}T00:00:00+08:00`).getUTCDay()]}</b><small>{date.slice(8, 10)}</small></span>)}</div><div className="widget-week-grid">{days.map(date => <div key={date} className={date === today ? 'today' : ''}>{rows.filter(row => row.date === date).slice(0, 4).map(row => <span style={{ background: row.color }} key={row.id}>{row.title}</span>)}</div>)}</div></div>;
}
export async function clearDesktopWidgets() {
  syncGeneration++;
  if (Capacitor.isNativePlatform()) await Widgets.clear();
}
export function useDesktopWidgets(state, onNavigate) {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!state) {
      if (!getToken()) clearDesktopWidgets().catch(() => {});
      return;
    }
    const generation = ++syncGeneration;
    let disposed = false, version = 0;
    const sync = async () => {
      const current = ++version;
      const planner = await request('/planner');
      if (disposed || current !== version || generation !== syncGeneration) return;
      await Widgets.sync({ snapshot: widgetSnapshot(state.records, planner, settingsFor(state.user.id)) });
    };
    const foreground = () => {
      if (document.hidden) return;
      sync().catch(() => {});
      Widgets.getLaunchTarget().then(({ target }) => {
        if (!disposed && ['tasks', 'courses'].includes(target)) navigate.current(target);
      }).catch(() => {});
    };
    foreground();
    window.addEventListener('widget-settings-changed', foreground);
    window.addEventListener('widget-data-changed', foreground);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      disposed = true;
      window.removeEventListener('widget-settings-changed', foreground);
      window.removeEventListener('widget-data-changed', foreground);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [state?.records, state?.user.id]);
}
export function DesktopWidgetSettings({ userId, records, onBack }) {
  const [settings, setSettings] = useState(() => settingsFor(userId));
  const [snapshot, setSnapshot] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const platform = Capacitor.getPlatform();
  async function refresh(next = settings) {
    setBusy(true); setMessage('');
    const generation = syncGeneration, token = getToken();
    try {
      const planner = await request('/planner');
      if (generation !== syncGeneration || token !== getToken()) return;
      const data = widgetSnapshot(records, planner, next);
      if (Capacitor.isNativePlatform()) await Widgets.sync({ snapshot: data });
      setSnapshot(data);
      setMessage(platform === 'web' ? '网页预览；添加桌面组件请使用安卓或 iPhone 安装包。' : '已同步，桌面刷新时间由系统决定。');
    } catch (error) { setMessage(`同步失败：${error.message}`); }
    finally { setBusy(false); }
  }
  async function update(patch) {
    const next = { ...settings, ...patch };
    try { localStorage.setItem(key(userId), JSON.stringify(next)); }
    catch { setMessage('设置未保存，请检查设备存储空间'); return; }
    setSettings(next);
    window.dispatchEvent(new Event('widget-settings-changed'));
    await refresh(next);
  }
  async function add(kind) {
    if (platform === 'ios') { setMessage('长按手机桌面 → 编辑 → 添加小组件，搜索“在在”，选择待办或课程提醒。'); return; }
    if (platform !== 'android') { setMessage('请在安卓或 iPhone 安装包中添加桌面组件。'); return; }
    try {
      const result = await Widgets.pin({ kind });
      setMessage(result.requested ? '已向桌面发送添加请求，请在系统弹窗中确认。' : '请长按桌面，在小组件列表中选择“在在”。');
    } catch (error) { setMessage(`无法添加：${error.message}`); }
  }
  return <section className="desktop-widget-settings" aria-label="桌面小组件">
    <header><button className="icon-button" title="返回工具箱" aria-label="返回工具箱" onClick={onBack}><ArrowLeft size={20} /></button><h2>桌面小组件</h2>
      <button className="icon-button" title="刷新组件" aria-label="刷新组件" disabled={busy} onClick={() => refresh()}><RefreshCw size={19} /></button></header>
    <label className="widget-switch"><span>桌面显示具体内容</span><input type="checkbox" role="switch" checked={settings.showContent} disabled={busy} onChange={e => update({ showContent: e.target.checked })} /></label>
    <p className="calc-note">内容自动读取应用中的待办和课程，不需要在小组件里重复填写。退出账号后清空组件数据。</p>
    <div className="widget-style-field"><span>小组件样式</span><div className="widget-style-tabs" role="tablist" aria-label="小组件样式">
      {[['week', '7天视图'], ['list', '日程列表'], ['month', '月历和日程']].map(([value, label]) => <button key={value} role="tab" aria-selected={settings.layout === value} className={settings.layout === value ? 'active' : ''} disabled={busy} onClick={() => update({ layout: value })}>{label}</button>)}
    </div></div>
    <label className="widget-source-field">显示主题<select aria-label="小组件显示主题" disabled={busy} value={settings.source} onChange={e => update({ source: e.target.value })}><option value="both">待办和课程</option><option value="tasks">仅待办</option><option value="courses">仅课程</option></select></label>
    <div className="widget-showcase" aria-label="小组件预览"><div className="widget-showcase-title"><strong>在在</strong><span>{settings.layout === 'week' ? '7天视图' : settings.layout === 'list' ? '日程列表' : '月历和日程'}</span></div><WidgetPreview snapshot={snapshot} settings={settings} /></div>
    {['tasks', 'courses'].map(kind => {
      const Icon = kind === 'tasks' ? ListChecks : CalendarDays;
      return <section className="widget-config" key={kind}>
        <label className="widget-switch"><span><Icon size={18} />{kind === 'tasks' ? '待办' : '课程提醒'}</span><input type="checkbox" role="switch" checked={settings[kind]} disabled={busy} onChange={e => update({ [kind]: e.target.checked })} /></label>
        {kind === 'tasks' && <label>显示范围<select aria-label="待办组件显示范围" disabled={busy} value={settings.taskScope} onChange={e => update({ taskScope: e.target.value })}><option value="today">今日待办</option><option value="all">全部未完成</option></select></label>}
        <div className="widget-preview" aria-label={kind === 'tasks' ? '待办组件预览' : '课程组件预览'}>
          <strong>{kind === 'tasks' ? '在在 · 待办' : '在在 · 课程提醒'}</strong>
          {!settings[kind] ? <p>未启用</p> : !settings.showContent ? <p>内容已隐藏，打开应用查看</p> : snapshot?.[kind].rows.length
            ? snapshot[kind].rows.slice(0, 3).map((row, index) => <div key={index}><b>{row.title}</b><small>{row.detail}</small></div>)
            : <p>{snapshot?.[kind].message || '点击刷新查看'}</p>}
        </div>
        <button className="secondary" disabled={!settings[kind] || busy} onClick={() => add(kind)}><Plus size={17} />添加到桌面</button>
      </section>;
    })}
    <p className="calc-note">课程取自“我的授课”，包含调课和代课。组件同步应用内数据，不会自行发出通知；到点提醒仍由原有提醒设置控制。数据超过一天未同步时，提示打开应用刷新。</p>
    {message && <p className="calc-note" role="status">{message}</p>}
  </section>;
}
