import { DateInput } from './date-picker';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserRound, Wallet, CalendarDays, CalendarClock, ListChecks, Volume2, Palette, Bell, BellRing, Download, LockKeyhole, EyeOff, History, ArrowLeftRight, Clock, BookOpen, Pencil, PanelsTopLeft, ScanLine, ShieldCheck, Eraser, UserPlus, ChevronRight } from 'lucide-react';
import { registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { exportLedger, isNative } from './api';
import { usePreferences } from './app-preferences';
import { AppLockSettings, useAppLock } from './app-lock';
import './settings-menu.css';

const unavailable = {
  accounts: ['收支账户', '暂未开放银行卡、现金等账户管理。当前记账仍按收支和类别记录。'],
  monthStart: ['每月开始于', '当前从每月 1 日开始统计，年、月账单使用自然年和自然月。自定义结算日暂未开放。'],
  migration: ['数据迁移', '暂未开放跨账本迁移或导入。可以导出账目 CSV；导出文件不等于完整备份。'],
  scheduled: ['定时记账', '暂未开放自动周期记账。定时提醒可创建待办，到时提醒你手动记账。'],
  books: ['分账本快捷入口', '当前只有一个账本，暂未开放多账本和账本切换。'],
  widgets: ['桌面小组件', '安卓桌面小组件暂未开发，当前网页预览不提供模拟的小组件开关。'],
  templates: ['模板记账', '模板和桌面快捷记账暂未开放。'],
  screenshot: ['截屏自动记账', '暂不读取手机截图或监控其他应用。可以在助手中主动上传图片识别，核对后确认入账。'],
  invite: ['邀请好友', '目前为封闭内测，暂未开放分享邀请链接。请由管理员分配测试资格。'],
};
const directionLabels = { ask: '每次选择', expense: '支出', income: '收入' };
const ReminderSound = registerPlugin('ReminderSound');
export function SettingsMenu({ Modal, onBack, onAccount, onTrash, onReminder, onNotify, children }) {
  const { preferences, update } = usePreferences();
  const appLock = useAppLock();
  const [screen, setScreen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState('');
  const [exportMonth, setExportMonth] = useState('');
  const [ringtone, setRingtone] = useState({ title: isNative ? '读取中…' : '手机端设置' });
  const titles = { calendar: '日历设置', direction: '默认记账类型', appearance: '个性装扮', sound: '声音与触感', ringtone: '提醒铃声', export: '导出数据', permissions: '系统权限', cache: '清除缓存' };
  const open = value => { setError(''); setPermission(''); setScreen(value); };
  async function run(action) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(err.message || '操作失败，请重试'); } finally { setBusy(false); }
  }
  function change(values) {
    try { update(values); } catch { setError('设置未保存，本机存储不可用'); }
  }
  useEffect(() => {
    if (!isNative) return;
    let active = true;
    const read = () => {
      if (document.hidden) return;
      ReminderSound.get().then(value => { if (active) setRingtone(value); })
        .catch(() => { if (active) setRingtone({ title: '读取失败' }); });
    };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    return () => { active = false; window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', read); };
  }, []);
  function chooseRingtone() {
    if (!isNative || ringtone.available === false) { open('ringtone'); return; }
    void run(async () => { setRingtone(await ReminderSound.open()); });
  }
  useEffect(() => {
    if (screen !== 'permissions') return;
    let active = true;
    if (isNative) LocalNotifications.checkPermissions().then(result => { if (active) setPermission(result.display === 'granted' ? '已允许通知' : '通知尚未允许'); }).catch(() => { if (active) setPermission('无法查询通知权限'); });
    else setPermission('网页预览不提供安卓系统通知；麦克风和相机权限由浏览器管理。');
    return () => { active = false; };
  }, [screen]);
  const row = (Icon, label, action, value, note) => <button key={label} className="preferences-row" onClick={action}><Icon size={21} /><span><span>{label}</span>{note && <small>{note}</small>}</span>{value && <small className="preferences-value">{value}</small>}<ChevronRight size={17} /></button>;
  const pending = (Icon, key, note) => row(Icon, unavailable[key][0], () => open(key), key === 'monthStart' ? '1日' : '暂未开放', note);
  const toggle = (Icon, label, name, note) => <label className="preferences-row" key={name}><Icon size={21} /><span><span>{label}</span>{note && <small>{note}</small>}</span><input className="switch" type="checkbox" aria-label={label} checked={preferences[name]} onChange={event => change({ [name]: event.target.checked })} /></label>;
  return <main className="preferences-page">
    <header className="preferences-heading"><button className="icon-button" aria-label="返回我的" onClick={onBack}><ArrowLeft size={22} /></button><h1>设置</h1><span /></header>
    <section className="preferences-group">{row(UserRound, '账号设置', onAccount)}</section>
    <section className="preferences-group" aria-label="功能设置"><h2>功能设置</h2>
      {pending(Wallet, 'accounts')}
      {row(CalendarDays, '日历设置', () => open('calendar'), preferences.calendarScope === 'month' ? '整月' : '今天')}
      {pending(CalendarClock, 'monthStart')}
      {row(ListChecks, '默认记账类型', () => open('direction'), directionLabels[preferences.defaultDirection])}
    </section>
    <section className="preferences-group" aria-label="个性化设置"><h2>个性化设置</h2>
      {row(Volume2, '声音与触感', () => open('sound'))}
      {row(BellRing, '提醒铃声', chooseRingtone, ringtone.title)}
      {row(Palette, '个性装扮', () => open('appearance'))}
      {row(Bell, '定时提醒', onReminder, '待办提醒')}
    </section>
    <section className="preferences-group" aria-label="数据安全"><h2>数据安全</h2>
      {row(Download, '导出数据', () => open('export'), 'CSV')}
      {row(LockKeyhole, '应用锁', () => open('lock'), appLock.config.enabled ? '已开启' : '未开启', '密码、手势与系统人脸验证')}
      {toggle(EyeOff, '隐藏总金额', 'hideTotals', '隐藏明细和账单页顶部汇总，不隐藏逐笔账目')}
      {row(History, '数据恢复', onTrash, null, '查看回收站并恢复记录')}
      {pending(ArrowLeftRight, 'migration')}
    </section>
    <section className="preferences-group" aria-label="快捷使用"><h2>快捷使用</h2>
      {pending(Clock, 'scheduled')}
      {pending(BookOpen, 'books')}
      {toggle(Pencil, '快捷编辑', 'quickEdit', '开启后，点击账目直接进入编辑')}
      {pending(PanelsTopLeft, 'widgets')}
      {pending(ListChecks, 'templates')}
      {pending(ScanLine, 'screenshot')}
    </section>
    <section className="preferences-group" aria-label="系统设置"><h2>系统设置</h2>
      {row(ShieldCheck, '系统权限', () => open('permissions'))}
      {row(Eraser, '清除缓存', () => open('cache'))}
      {pending(UserPlus, 'invite')}
    </section>
    <div className="preferences-assistant">{children}</div>
    {error && !screen && <p className="error-box" role="alert">{error}</p>}
    {screen === 'lock' && <AppLockSettings Modal={Modal} onClose={() => setScreen('')} />}
    {screen && screen !== 'lock' && <Modal title={unavailable[screen]?.[0] || titles[screen]} onClose={() => { if (!busy) setScreen(''); }}>
      <div className="preferences-detail">
        {unavailable[screen] && <><h3>{screen === 'monthStart' ? '自然月统计' : '暂未开放'}</h3><p>{unavailable[screen][1]}</p></>}
        {screen === 'direction' && <div role="group" aria-label="默认记账类型">{Object.entries(directionLabels).map(([value, label]) => <button className="preferences-choice" key={value} aria-pressed={preferences.defaultDirection === value} onClick={() => change({ defaultDirection: value })}>{label}</button>)}</div>}
        {screen === 'calendar' && <><p>进入明细页时默认查看</p><div role="group" aria-label="默认日期范围">{[['month', '整月'], ['today', '今天']].map(([value, label]) => <button className="preferences-choice" key={value} aria-pressed={preferences.calendarScope === value} onClick={() => change({ calendarScope: value })}>{label}</button>)}</div></>}
        {screen === 'appearance' && <div className="preferences-swatches" role="group" aria-label="主题色">{[['blue', '蓝色'], ['green', '绿色'], ['rose', '玫红']].map(([value, label]) => <button key={value} className={`theme-swatch theme-${value}`} title={label} aria-label={label} aria-pressed={preferences.theme === value} onClick={() => change({ theme: value })} />)}</div>}
        {screen === 'sound' && <>{toggle(Volume2, '按键音', 'keySound', '按钮与应用内键盘的轻提示音，通话时暂停')}<p>音量跟随设备媒体音量，不改变通话和系统通知音量。</p>{typeof navigator.vibrate === 'function' ? toggle(Volume2, '轻触振动', 'haptics', '由设备和系统设置决定是否支持') : <p>当前设备不支持网页振动。</p>}</>}
        {screen === 'ringtone' && <p>{isNative ? ringtone.reason : '网页版无法读取手机自带铃声。请在安卓安装包中设置提醒铃声，所有提醒共用手机系统中的选择。'}</p>}
        {screen === 'export' && <><p>导出已确认且未删除的收支账目，不包含聊天、头像或账号密码。</p><label>月份（留空导出全部）<DateInput type="month" value={exportMonth} onChange={event => setExportMonth(event.target.value)} disabled={busy} /></label><button className="primary" disabled={busy} onClick={() => run(async () => { if (await exportLedger(exportMonth ? { month: exportMonth } : {})) onNotify('账目 CSV 已导出'); })}>{busy ? '正在导出' : '导出 CSV'}</button></>}
        {screen === 'permissions' && <><p role="status">{permission}</p>{isNative && <button className="primary" disabled={busy} onClick={() => run(async () => { const result = await LocalNotifications.requestPermissions(); setPermission(result.display === 'granted' ? '已允许通知' : '未允许通知，请在手机系统设置中检查'); })}>申请通知权限</button>}<p>麦克风仅在开始通话时申请；照片仅在主动拍照或选择图片时访问。</p></>}
        {screen === 'cache' && <><p>只清理本应用的网页资源缓存，不删除账单、聊天、头像、登录状态或偏好设置。</p><button className="secondary" disabled={busy} onClick={() => run(async () => {
          if (!window.confirm('清理本应用资源缓存？账号与记录会保留。')) return;
          const keys = 'caches' in window ? (await caches.keys()).filter(key => key.startsWith('zaizai-')) : [];
          await Promise.all(keys.map(key => caches.delete(key)));
          onNotify(keys.length ? '资源缓存已清理' : '当前没有可清理的应用资源缓存');
        })}>{busy ? '正在清理' : '清除缓存'}</button></>}
        {error && <p className="error-box" role="alert">{error}</p>}
      </div>
    </Modal>}
  </main>;
}
