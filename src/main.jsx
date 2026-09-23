import { DateInput } from './date-picker';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ArrowRight, Bell, BellOff, CalendarDays, Check, ChevronDown, ChevronRight,
  Circle, Clock3, Coffee, Heart, History, House, ListChecks, LoaderCircle, LogOut,
  MessageCircle, Mic, MicOff, MoreHorizontal, Pencil, Phone, PhoneOff, Plus, Scale, Send,
  Settings2, ShieldCheck, Sparkles, Trash2, Wallet, X, RotateCcw, Camera, UserRound, Minus, PanelsTopLeft, GraduationCap,
} from 'lucide-react';
import { getBase, getToken, isNative, request, syncReminders } from './api';
import { AssistantEdge, DesktopAssistantLifecycle, NativeAssistant, overlaySession } from './floating-assistant';
import { VoiceCall } from './voice';
import { mergeMessages } from './timeline';
import { Ledger, BatchReview } from './bookkeeping';
import { ExpenseEntry } from './expense-entry';
import { PAGE_LABELS, PAGE_KIND, initialPage, pendingForPage, requestId as newRequestId } from './navigation';
import { TaskFields, TaskPriorityField } from './task-fields';
import { Planner } from './planner';
import { AddMenu } from './add-menu';
import { HabitReminders } from './habit-reminders';
import { TaskSchedule } from './task-schedule';
import { TaskPhotos } from './task-photos';
import { ReceiptModal } from './receipt';
import { PreviewKeyboard } from './preview-keyboard';
import { DebtManager } from './debts';
import { DebtRepaymentReview } from './debt-repayment-review';
import { MinePage } from './mine-page';
import { SystemMessages } from './system-messages.jsx';
import { AccountService } from './account-services';
import { AccountSettings } from './account-settings';
import { UserAvatar } from './user-avatar';
import { SettingsMenu } from './settings-menu';
import { PreferencesProvider } from './app-preferences';
import { useDesktopWidgets, clearDesktopWidgets } from './desktop-widgets';
import { AppLockProvider } from './app-lock';
import './style.css';
import './interface.css';
import './receipt.css';

const PERSONAS = {
  gentle: { name: '小在', label: '温柔型', detail: '先听你说，再陪你做', color: 'green', initial: '在' },
  blunt: { name: '阿直', label: '直球型', detail: '话说得直，事陪你办', color: 'coral', initial: '直' },
  witty: { name: '小酸', label: '嘴损型', detail: '嘴上吐槽，心里惦记', color: 'blue', initial: '酸' },
};
const NAVIGATION = [['ledger', Wallet, '记账'], ['tasks', ListChecks, '待办'], ['health', Heart, '健康'], ['mine', UserRound, '我的']];
const dateString = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const money = cents => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '没有指定时间';
const localInput = value => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={20} /></button>;
}
function Avatar({ persona = 'gentle', size = '', speaking = false }) {
  const item = PERSONAS[persona];
  return <span className={`avatar ${item.color} ${size} ${speaking ? 'speaking' : ''}`}>
    {persona === 'gentle' ? <img src="/assistant-mascot.svg" alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
    <span>{item.initial}</span>
  </span>;
}
function Empty({ icon: Icon, title, detail, children }) {
  return <div className="empty"><Icon size={28} strokeWidth={1.4} /><strong>{title}</strong><p>{detail}</p>{children}</div>;
}
function Modal({ title, onClose, children, wide = false, fullScreen = false, onBack, className = '', actions }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const fields = () => [...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length > 0);
    fields()[0]?.focus();
    const keydown = event => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const list = fields();
      if (event.shiftKey && document.activeElement === list[0]) { event.preventDefault(); list.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === list.at(-1)) { event.preventDefault(); list[0]?.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => { dialog.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className={`modal-backdrop${fullScreen ? ' fullscreen-backdrop' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} className={`modal ${wide ? 'wide' : ''}${fullScreen ? ' fullscreen-modal' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading">{onBack && <IconButton icon={ArrowLeft} label="上一步" onClick={onBack} />}<h2>{title}</h2>{actions}<IconButton icon={X} label="关闭" onClick={onClose} /></div>
      {children}
      <PreviewKeyboard dialogRef={ref} />
    </section>
  </div>;
}

function Auth({ onLogin }) {
  const phonePreview = import.meta.env.DEV
    && ['127.0.0.1', 'localhost'].includes(location.hostname)
    && new URLSearchParams(location.search).get('preview') === 'phone';
  const [register, setRegister] = useState(!phonePreview);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [server, setServer] = useState(getBase());
  async function submit(event) {
    event.preventDefault();
    setError(''); setLoading(true);
    try {
      const value = server.trim().replace(/\/$/, '');
      if (value && !/^https?:\/\/[^/\s]+(?::\d+)?$/.test(value)) throw new Error('服务地址需为 http://地址:端口 或 HTTPS 域名');
      if (value) localStorage.setItem('zaizai-server', value);
      else localStorage.removeItem('zaizai-server');
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const result = await request(register ? '/register' : '/login', { method: 'POST', body });
      localStorage.setItem('zaizai-token', result.token);
      onLogin(result);
    } catch (error) { setError(error.message === 'Failed to fetch' ? '连不上服务，请检查地址和网络' : error.message); }
    finally { setLoading(false); }
  }
  return <main className="auth-page">
    <div className="auth-brand"><img src="/app-icon.png" alt="" /><span>在在</span><small>内测版</small></div>
    <section className="auth-content">
      <div className="auth-intro"><span className="eyebrow">日子慢慢过，事情一起做</span><h1>今天，也有人<br />惦记着你。</h1><Avatar size="large" /><p>你好，我是小在。</p></div>
      <form onSubmit={submit} className="auth-form">
        <div className="auth-tabs"><button type="button" className={register ? 'active' : ''} onClick={() => setRegister(true)}>加入内测</button><button type="button" className={!register ? 'active' : ''} onClick={() => setRegister(false)}>已有账号</button></div>
        {register && <label>怎么称呼你<input name="name" placeholder="你的昵称" maxLength={24} required autoComplete="nickname" /></label>}
        <label>账号<input name="username" placeholder="字母、数字或邮箱" minLength={3} maxLength={40} required autoComplete="username" /></label>
        <label>密码<input name="password" type="password" placeholder="至少 10 位" minLength={10} maxLength={128} required autoComplete={register ? 'new-password' : 'current-password'} /></label>
        {register && <div className="form-columns"><label>出生日期<DateInput name="birthday" type="date" max={dateString()} required /></label><label>内测邀请码<input name="invite" placeholder="邀请码" required autoComplete="off" /></label></div>}
        <details className="server-setting" open={isNative && !getBase()}><summary>服务连接 <Settings2 size={13} /></summary><label>私有服务地址<input value={server} onChange={e => setServer(e.target.value)} placeholder="留空使用当前网站" inputMode="url" /></label></details>
        {register && <label className="consent"><input type="checkbox" required /><span>同意将对话与录音发送至配置的 AI 服务。录音不在本 App 留存，对话和记录保存在私有服务。未成年人仅开放朋友模式。</span></label>}
        {error && <div role="alert" className="error-box">{error}</div>}
        <button className="primary full" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{register ? '认识一下' : '回到在在'}</button>
      </form>
    </section>
    <footer className="auth-footer"><ShieldCheck size={14} /> 邀请制内测 · 暂不开放付费</footer>
  </main>;
}

function TaskNote({ value }) {
  const ref = useRef(null);
  function fit() {
    const input = ref.current;
    if (!input) return;
    input.style.height = 'auto';
    const style = getComputedStyle(input);
    input.style.height = `${input.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
  }
  useLayoutEffect(() => {
    fit();
    let width = ref.current.clientWidth;
    const observer = new ResizeObserver(() => {
      if (ref.current.clientWidth !== width) { width = ref.current.clientWidth; fit(); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <label>备注<textarea ref={ref} aria-label="备注" className="task-note" name="note" maxLength={500} rows={3} defaultValue={value || ''} onInput={fit} /></label>;
}

function RecordForm({ initial, kind: initialKind, onClose, onSave, onDebt, defaults = {} }) {
  const [photos, setPhotos] = useState(initial?.payload?.photos || []);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [kind, setKind] = useState(initialKind || initial?.kind || 'task');
  const [classifying, setClassifying] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(newRequestId());
  const p = initial?.payload || defaults;
  if (kind === 'expense') return <ExpenseEntry Modal={Modal} initial={initial} onClose={onClose} onSave={onSave} onDebt={onDebt} />;
  async function submit(event) {
    event.preventDefault();
    if (pending || photoBusy) return;
    setPending(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.due) data.due = new Date(`${data.due}:00+08:00`).toISOString();
    try {
      if (kind === 'task') {
        if (data.reminderDays !== undefined) {
          data.reminderDays = JSON.parse(data.reminderDays);
          if (!data.reminderDays.length) throw new Error('请至少选择一个提醒日期');
        }
        data.photos = [];
        for (const photo of photos) {
          if (!photo.startsWith('data:')) { data.photos.push(photo); continue; }
          const saved = await request('/task-photos', { method: 'POST', body: { image: photo } });
          data.photos.push(saved.id);
        }
        data.photos = [...new Set(data.photos)];
      }
      await onSave(kind, data, initial, event.nativeEvent.submitter?.value, requestId.current); onClose();
    }
    catch (error) { setError(error.message); }
    finally { setPending(false); }
  }
  return <Modal fullScreen={kind === 'task'} className={kind === 'task' ? 'planner-task-editor' : ''} title={initial ? initial.status === 'confirmed' ? '修改记录' : '核对并确认' : { task: '添加待办', expense: '记一笔', weight: '记录体重' }[kind]} onClose={pending ? () => {} : onClose}>
    <form onSubmit={submit} className="record-form">
      {!initial && !initialKind && <div className="segmented">{[['task', ListChecks, '待办'], ['expense', Wallet, '记账'], ['weight', Scale, '体重']].map(([value, Icon, label]) => <button type="button" className={kind === value ? 'active' : ''} key={value} onClick={() => setKind(value)}><Icon size={16} />{label}</button>)}</div>}
      {kind === 'task' && <>
        <TaskFields initial={initial} defaultCategory={defaults.category} onBusyChange={setClassifying} />
        <TaskSchedule initial={initial} payload={p} />
        <TaskPriorityField value={p.priority} />
        <TaskNote value={p.note} />
        <TaskPhotos photos={photos} onChange={setPhotos} disabled={pending} onBusyChange={setPhotoBusy} />
      </>}
      {kind === 'weight' && <label>体重（kg）<input name="kg" type="number" min="10" max="500" step=".1" placeholder="0.0" defaultValue={p.kg} required autoFocus /></label>}
      {kind === 'task' ? <input name="date" type="hidden" value={p.date || dateString()} /> : <label>记录日期<DateInput name="date" type="date" defaultValue={p.date || dateString()} required /></label>}
      {initial?.status === 'pending' && <div className="confirmation-note"><ShieldCheck size={16} /> 确认后才会正式保存{kind === 'task' ? '并设置提醒' : ''}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={pending} onClick={onClose}>取消</button>{initial?.status === 'pending' && <button type="submit" value="draft" disabled={pending || photoBusy || (kind === 'task' && classifying)} className="secondary">保存草稿</button>}<button type="submit" value="confirm" disabled={pending || photoBusy || (kind === 'task' && classifying)} className="primary">{pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{initial?.status === 'pending' ? '确认保存' : '保存'}</button></div>
    </form>
  </Modal>;
}

function App() {
  const [state, setState] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [bootError, setBootError] = useState('');
  const [page, updatePage] = useState(() => initialPage());
  const [mineView, setMineView] = useState('home');
  const [assistantOpen, setAssistantOpen] = useState(Boolean(overlaySession));
  const [nativeExpanded, setNativeExpanded] = useState(true);
  const [edgeVisible, setEdgeVisible] = useState(true);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [callStatus, setCallStatus] = useState(null);
  const [muted, setMuted] = useState(false);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [plannerCreateSignal, setPlannerCreateSignal] = useState(0);
  const [plannerCourseCreate, setPlannerCourseCreate] = useState(null);
  const [ledgerView, setLedgerView] = useState('details');
  const [debtCreateSignal, setDebtCreateSignal] = useState(0);
  const [widgetView, setWidgetView] = useState(null);
  useDesktopWidgets(state, target => { setWidgetView({ target, at: Date.now() }); setPage('tasks'); });
  const [usage, setUsage] = useState(null);
  const [trash, setTrash] = useState([]);
  const [pendingExpanded, setPendingExpanded] = useState({});
  const [chatReadMarkers, setChatReadMarkers] = useState({});
  const call = useRef(null);
  const scrollEnd = useRef(null);
  const followMessages = useRef(true);
  const toastTimer = useRef(null);
  const persona = PERSONAS[state?.user.persona || 'gentle'];
  const confirmed = state?.records.filter(r => r.status === 'confirmed') || [];
  const pending = state?.records.filter(r => r.status === 'pending') || [];
  const readKey = state ? `zaizai-chat-read-${state.user.id}` : '';
  const chatReadAt = chatReadMarkers[readKey] || localStorage.getItem(readKey) || '';
  const unreadCheckins = state?.messages.filter(item => item.proactive && item.created > chatReadAt).length || 0;
  const badgeCount = id => id === 'chat' ? unreadCheckins : PAGE_KIND[id] ? pendingForPage(state.records, id).length : 0;
  const weights = confirmed.filter(r => r.kind === 'weight').sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.created.localeCompare(a.created));
  function setPage(value) {
    if (value === 'chat') { openAssistant(); return; }
    if (!overlaySession) setAssistantOpen(false);
    setMineView('home');
    updatePage(value);
    window.scrollTo({ top: 0 });
  }
  async function openAssistant() {
    if (call.current && !call.current.closed) {
      setEdgeVisible(true); setAssistantOpen(true); return;
    }
    if (isNative) {
      try {
        const status = await NativeAssistant.status();
        if (!status.permitted) {
          await NativeAssistant.requestOverlayPermission();
          notify('允许显示在其他应用上层后，助手才能在退出 App 后保留');
          return;
        }
        await NativeAssistant.show({ token: getToken(), base: getBase(), userId: state.user.id });
        localStorage.setItem(`zaizai-desktop-assistant-${state.user.id}`, 'true');
        setDesktopEnabled(true);
        setAssistantOpen(false); setEdgeVisible(false);
        return;
      } catch (error) { notify(error.message || '桌面助手未能开启，已打开应用内助手'); }
    }
    setEdgeVisible(true); setAssistantOpen(true);
  }
  function collapseAssistant() {
    if (overlaySession) window.ZaizaiAssistant.collapse();
    else setAssistantOpen(false);
  }
  async function toggleDesktopAssistant() {
    if (!isNative) { notify('网页仅支持应用内悬浮窗，桌面悬浮需使用安卓安装包'); return; }
    try {
      if (desktopEnabled) {
        if (!window.confirm('关闭桌面悬浮助手？正在进行的通话也会挂断。')) return;
        await NativeAssistant.stop();
        localStorage.setItem(`zaizai-desktop-assistant-${state.user.id}`, 'false');
        setDesktopEnabled(false); setEdgeVisible(true);
        return;
      }
      if (call.current && !call.current.closed) { notify('请先挂断当前通话，再开启桌面悬浮助手'); return; }
      const status = await NativeAssistant.status();
      if (!status.permitted) {
        await NativeAssistant.requestOverlayPermission();
        notify('请允许显示在其他应用上层，返回后再次开启');
        return;
      }
      await NativeAssistant.show({ token: getToken(), base: getBase(), userId: state.user.id });
      localStorage.setItem(`zaizai-desktop-assistant-${state.user.id}`, 'true');
      setDesktopEnabled(true); setAssistantOpen(false); setEdgeVisible(false);
    } catch (error) { notify(error.message || '无法开启桌面悬浮助手'); }
  }

  function notify(value) {
    setToast(value);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  }
  function acceptState(result, resetHistory = false) {
    setState(previous => ({
      ...result,
      messages: !resetHistory && previous?.user.id === result.user.id ? mergeMessages(previous.messages, result.messages) : result.messages,
    }));
  }
  async function refresh() {
    const token = getToken();
    let result;
    try { result = await request('/state'); }
    catch (error) {
      if (overlaySession && error.status === 401) {
        call.current?.close(); setState(null);
        window.ZaizaiAssistant.stop();
      }
      throw error;
    }
    if (token === getToken()) acceptState(result);
    return result;
  }
  useEffect(() => {
    if (getToken()) refresh().catch(error => {
      if (error.status === 401) localStorage.removeItem('zaizai-token');
      else setBootError(error.message);
    }).finally(() => setBooting(false));
    return () => call.current?.close();
  }, []);
  useEffect(() => {
    if (state) setDesktopEnabled(localStorage.getItem(`zaizai-desktop-assistant-${state.user.id}`) === 'true');
  }, [state?.user.id]);
  useEffect(() => {
    if (!overlaySession) return;
    window.ZaizaiAssistant.setCallActive(Boolean(callStatus));
  }, [callStatus]);
  useEffect(() => {
    if (!overlaySession) return;
    const ready = () => startCall(true);
    const failed = event => notify(event.detail || '麦克风权限未开启');
    const stop = () => endCall();
    const visibility = event => setNativeExpanded(event.detail === 'open');
    window.addEventListener('assistant-voice-ready', ready);
    window.addEventListener('assistant-voice-error', failed);
    window.addEventListener('assistant-hangup', stop);
    window.addEventListener('assistant-visibility', visibility);
    return () => {
      window.removeEventListener('assistant-voice-ready', ready);
      window.removeEventListener('assistant-voice-error', failed);
      window.removeEventListener('assistant-hangup', stop);
      window.removeEventListener('assistant-visibility', visibility);
    };
  }, [sending]);
  useEffect(() => {
    if (!state) return;
    const foreground = () => { if (!document.hidden) refresh().catch(() => {}); };
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => {});
    }, 30000);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [state?.user.id]);
  useEffect(() => {
    if (state) syncReminders(state.records).catch(() => {});
  }, [state?.records]);
  useEffect(() => {
    const latest = state?.messages.at(-1)?.created;
    if (!assistantOpen || (overlaySession && !nativeExpanded) || !latest || latest <= chatReadAt) return;
    localStorage.setItem(readKey, latest);
    setChatReadMarkers(previous => ({ ...previous, [readKey]: latest }));
  }, [assistantOpen, nativeExpanded, readKey, state?.messages, chatReadAt]);
  useEffect(() => {
    if (assistantOpen && followMessages.current) scrollEnd.current?.scrollIntoView({ block: 'end' });
  }, [state?.messages.length, state?.messages.at(-1)?.text, sending]);
  useEffect(() => {
    if (assistantOpen) {
      followMessages.current = true;
      scrollEnd.current?.scrollIntoView({ block: 'end' });
    }
  }, [assistantOpen]);
  useEffect(() => {
    if (!callStatus || callStatus === 'ended') return;
    const timer = setInterval(() => setCallSeconds(v => v + 1), 1000);
    return () => clearInterval(timer);
  }, [Boolean(callStatus && callStatus !== 'ended')]);

  async function action(path, options, success) {
    try {
      const result = await request(path, options);
      if (result.user) acceptState(result, path === '/history');
      if (call.current?.ready && options?.method !== 'GET') call.current.send({ type: 'app.refresh_context' });
      if (success) notify(success);
      return result;
    } catch (error) { notify(error.message); throw error; }
  }
  async function saveRecord(kind, payload, record, intent, requestId) {
    const editing = record?.status === 'confirmed' || intent === 'draft';
    const result = await request(record ? `/records/${record.id}${editing ? '' : '/confirm'}` : '/records', {
      method: record && editing ? 'PATCH' : 'POST',
      body: record ? { payload, revision: record.revision } : { kind, payload, confirmed: true, requestId },
    });
    acceptState(result);
    if (call.current?.ready) call.current.send({ type: 'app.refresh_context' });
    notify(intent === 'draft' ? '草稿已更新，尚未入账' : '已确认保存');
    if (intent !== 'draft' && kind === 'task' && payload.due) syncReminders(result.records, true).catch(error => notify(error.message));
  }
  async function complete(record) {
    await action(`/records/${record.id}/complete`, { method: 'POST', body: { completed: !record.completed } }, record.completed ? '已恢复待办' : '这件事完成了');
  }
  async function remove(record) {
    if (record.source === 'debt-repayment') {
      notify('请在原欠条中撤销还款，对应收入会同步撤销');
      setModal({ type: 'debts', billId: record.payload.debtBillId });
      return;
    }
    if (!window.confirm(`将“${record.payload.title}”移入回收站？可以恢复。`)) return;
    await action(`/records/${record.id}`, { method: 'DELETE' }, '已移入回收站，可恢复');
  }
  async function openTrash(kind) {
    try {
      setTrash((await request('/records/trash')).records.filter(r => !kind || r.kind === kind));
      setModal({ type: 'trash', kind });
    } catch (error) { notify(error.message); }
  }
  async function send(event) {
    event?.preventDefault();
    if (!text.trim() || sending) return;
    const value = text.trim();
    if (call.current && !call.current.closed) {
      try { call.current.sendText(value); setText(''); }
      catch (error) { notify(error.message); }
      return;
    }
    setText(''); setSending(true);
    setState(previous => ({ ...previous, messages: [...previous.messages, { id: `sending-${Date.now()}`, role: 'user', text: value, created: new Date().toISOString() }] }));
    try { acceptState(await request('/chat', { method: 'POST', body: { text: value } })); }
    catch (error) { notify(error.message); setText(value); await refresh().catch(() => {}); }
    finally { setSending(false); }
  }
  function voiceEvent(event) {
    if (event.type === 'app.records_changed') refresh().catch(() => {});
    if (event.type === 'app.message') {
      setState(previous => previous?.user.id === event.message.user_id ?
        { ...previous, messages: mergeMessages(previous.messages, [event.message]) } : previous);
    }
  }
  async function startCall(nativeReady = false) {
    if (call.current && !call.current.closed) return;
    if (sending) { notify('先等这条消息回复完成'); return; }
    if (overlaySession && nativeReady !== true) { window.ZaizaiAssistant.prepareCall(); return; }
    setCallSeconds(0); setMuted(false); setMicrophoneActive(false); setCallStatus('connecting');
    const instance = new VoiceCall({
      base: getBase(), token: getToken(),
      onMicrophoneState: active => { if (call.current === instance) setMicrophoneActive(active); },
      onEvent: voiceEvent, onState: status => {
        setCallStatus(status === 'ended' ? null : status);
        if (status === 'ended') refresh().catch(() => {});
      }, onError: notify,
    });
    call.current = instance;
    await instance.start();
  }
  function endCall() {
    call.current?.close(); call.current = null;
    setCallStatus(null);
    setMicrophoneActive(false);
    refresh().catch(() => {});
  }
  async function profile(body) {
    await action('/profile', { method: 'PATCH', body });
  }
  async function logout() {
    await clearDesktopWidgets().catch(() => {});
    if (isNative) await NativeAssistant.stop().catch(() => {});
    endCall();
    await request('/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('zaizai-token');
    if (isNative) await syncReminders([]).catch(() => {});
    setAssistantOpen(false); setEdgeVisible(true);
    setModal(null); setState(null); setPage('ledger');
  }
  const safe = fn => (...args) => Promise.resolve(fn(...args)).catch(() => {});
  async function authorizeAssistant(decision) {
    const pendingAction = state.assistantAction;
    if (!pendingAction || authorizing) return;
    setAuthorizing(true);
    try {
      await action(`/assistant-actions/${pendingAction.id}/${decision}`, {
        method: 'POST', body: { summary: pendingAction.summary },
      }, decision === 'confirm' ? '已按确认内容执行' : '已取消');
    } catch { await refresh().catch(() => {}); }
    finally { setAuthorizing(false); }
  }
  if (booting) return <div className="boot"><LoaderCircle className="spin" /><span>回到在在…</span></div>;
  if (!state && overlaySession) return <div className="boot"><p>{bootError || '登录已失效，请返回应用重新登录'}</p><button onClick={() => window.ZaizaiAssistant.stop()}>关闭助手</button></div>;
  if (!state) return <><Auth onLogin={data => { setState(data); setBootError(''); }} />{bootError && <div className="toast" role="alert">{bootError}</div>}</>;

  function PendingSection({ scope = page }) {
    const scoped = pendingForPage(state.records, scope);
    const expanded = Boolean(pendingExpanded[scope]);
    if (!scoped.length) return null;
    return <section className="pending-section"><div className="section-heading"><h2>待确认 <span className="count">{scoped.length}</span></h2><span className="muted small">尚未保存</span></div>
      {scoped.some(r => r.kind === 'expense') && <button className="text-button" onClick={() => setModal({ type: 'batch' })}><Check size={16} />批量核对账目（{scoped.filter(r => r.kind === 'expense').length}）</button>}
      {(expanded ? scoped : scoped.slice(0, 2)).map(record => <div className="pending-row" key={record.id}>
        <span className="record-icon amber">{record.kind === 'expense' ? <Wallet size={19} /> : record.kind === 'weight' ? <Scale size={19} /> : <ListChecks size={19} />}</span>
        <div className="row-main"><strong>{record.payload.title}</strong><small>{record.kind === 'debt_repayment' ? `收到还款 ¥${money(record.payload.cents)} · ${record.payload.date} · 待关联原欠条` : record.kind === 'expense' ? `${record.payload.direction === 'income' ? '收入' : '支出'} ¥${money(record.payload.cents)} · ${record.payload.category} · ${record.payload.date}` : record.kind === 'weight' ? `${record.payload.kg} kg · ${record.payload.date}` : formatTime(record.payload.due)}</small></div>
        <button className="text-button" onClick={() => setModal({ type: record.kind === 'debt_repayment' ? 'repayment-review' : 'record', record })}>核对 <ChevronRight size={15} /></button>
        <IconButton icon={X} label="忽略这条草稿" onClick={safe(() => action(`/records/${record.id}/reject`, { method: 'POST' }))} />
      </div>)}
      {scoped.length > 2 && <button className="text-button pending-toggle" aria-expanded={expanded} onClick={() => setPendingExpanded(previous => ({ ...previous, [scope]: !expanded }))}>{expanded ? '收起' : `展开全部（${scoped.length} 条）`}<ChevronDown size={16} className={expanded ? 'rotated' : ''} /></button>}
    </section>;
  }
  const LockBoundary = overlaySession ? React.Fragment : AppLockProvider;
  return <LockBoundary {...(overlaySession ? {} : { key: state.user.id, user: state.user, onLogout: logout, onLock: () => { setAssistantOpen(false); setModal(null); } })}>
    {!overlaySession && <HabitReminders userId={state.user.id} records={state.records} onNotify={notify} />}
    <DesktopAssistantLifecycle userId={state.user.id} suspended={Boolean(callStatus)} onRunningChange={running => { setDesktopEnabled(running); setEdgeVisible(!running); }} />
    <PreferencesProvider userId={state.user.id}><div className={`app-shell page-${page}${overlaySession ? ' native-assistant-host' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><img src="/app-icon.png" alt="" /><span>在在</span><small>内测</small></div>
      <nav aria-label="主要功能">{NAVIGATION.map(([id, Icon, label]) => <button key={id} aria-label={label} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={20} /><span>{label}</span>{badgeCount(id) > 0 && <i aria-label={`${badgeCount(id)} 条待查看`}>{badgeCount(id)}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> 私人日常空间</div>
      <button className="account-mini" onClick={() => setPage('mine')}><UserAvatar user={state.user} /><div><strong>{state.user.name}</strong><small>今天也照顾好自己</small></div><ChevronRight size={16} /></button>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>在在 / {PAGE_LABELS[page]}</span><span className="private-label"><ShieldCheck size={14} /> 邀请制内测</span></header>
      {assistantOpen && <section className="chat-page assistant-panel" role="dialog" aria-label="助手对话" aria-modal="false">
        <div className="chat-heading"><Avatar persona={state.user.persona} /><div><strong>{persona.name}<span className="ai-label">AI 助手</span></strong><small>{persona.label}</small></div><IconButton icon={Phone} label="发起语音通话" className="green-button" disabled={Boolean(callStatus)} onClick={() => startCall()} /><IconButton icon={Minus} label="收起助手" onClick={collapseAssistant} /></div>
        <div className="messages" onScroll={event => {
          const list = event.currentTarget;
          followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}>
          {!state.messages.length && <div className="chat-welcome"><Avatar persona={state.user.persona} size="large" /><h2>从一句话开始。</h2><p>想聊的，想做的，都可以说。</p><div className="suggestions">{['今天有点累，什么都不想做', '帮我记一笔午饭，花了 28 元', '我想把最近的生活理一理'].map(value => <button key={value} onClick={() => setText(value)}>{value}<ArrowRight size={14} /></button>)}</div></div>}
          {state.messages.map(item => item.role === 'event' ? <div className="event-message" key={item.id}>{item.text}</div> : <div key={item.id} data-message-id={item.id} className={`message ${item.role}`}>
            {item.role === 'assistant' && <Avatar persona={item.persona || 'gentle'} size="small" />}
            <div><div className="bubble">{item.text}</div><time>{new Date(item.created).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
          </div>)}
          {sending && <div className="message assistant"><Avatar persona={state.user.persona} size="small" /><div className="typing"><span /><span /><span /></div></div>}
          {state.assistantAction && <section className="assistant-approval" aria-label="助手操作确认">
            <h3><ShieldCheck size={18} />待你确认</h3>
            <p>{state.assistantAction.summary}</p>
            <small>尚未执行 · 有效至{new Date(state.assistantAction.expires).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>
            <div><button className="secondary" disabled={authorizing || sending} onClick={() => authorizeAssistant('cancel')}>取消</button>
              <button className="primary" disabled={authorizing || sending} onClick={() => authorizeAssistant('confirm')}><Check size={16} />{authorizing ? '处理中' : '确认执行'}</button></div>
          </section>}
          <div ref={scrollEnd} />
        </div>
        {pending.length > 0 && <button className="pending-chat" onClick={() => setModal({ type: 'pending' })}><ShieldCheck size={17} /><span>{pending.length} 条记录等你核对</span><ChevronRight size={17} /></button>}
        {callStatus && <div className="assistant-call-controls" aria-label="通话控制"><span>{({ connecting: '正在连接', listening: muted ? '已静音' : '正在聆听', thinking: '正在思考', speaking: '正在说话' })[callStatus]}</span><time>{Math.floor(callSeconds / 60).toString().padStart(2, '0')}:{(callSeconds % 60).toString().padStart(2, '0')}</time><IconButton icon={muted ? MicOff : Mic} label={muted ? '取消静音' : '静音'} className={microphoneActive ? 'mic-active' : ''} aria-pressed={muted} data-microphone-state={muted ? 'muted' : microphoneActive ? 'active' : 'unavailable'} disabled={callStatus === 'connecting'} onClick={() => setMuted(call.current?.toggleMute())} /><IconButton icon={PhoneOff} label="结束通话" className="hangup" onClick={endCall} /></div>}
        <form className="composer" onSubmit={send}><IconButton icon={Plus} label="添加记录" onClick={() => setModal({ type: 'record-kind' })} type="button" />{!overlaySession && <IconButton icon={Camera} label="拍照识别小票" onClick={() => setModal({ type: 'receipt' })} type="button" />}<textarea aria-label="发送给助手的消息" value={text} onChange={e => setText(e.target.value)} placeholder={`和${persona.name}说点什么…`} maxLength={4000} rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><IconButton icon={sending ? LoaderCircle : Send} label="发送消息" className={`send-button ${sending ? 'spin-icon' : ''}`} type="submit" disabled={!text.trim() || sending} /></form>
      </section>}
      {!overlaySession && page === 'tasks' && <Planner key={state.user.id} userId={state.user.id} widgetView={widgetView} openCourse={plannerCourseCreate} records={state.records} Modal={Modal} pending={<PendingSection scope="tasks" />} createSignal={plannerCreateSignal} onNotify={notify}
        onCreateTask={defaults => setModal({ type: 'record', kind: 'task', defaults })} onEditTask={record => setModal({ type: 'record', record })} onComplete={complete}
        onDeleteTask={record => action(`/records/${record.id}`, { method: 'DELETE' }, '已移入回收站，可恢复')} />}
      {!overlaySession && PAGE_KIND[page] && page !== 'tasks' && <main className={`records-page module-page ${page}-page`}>
        <div className="page-heading"><h1>{PAGE_LABELS[page]}</h1><div className="module-actions"><button className="primary record-add" onClick={() => setModal({ type: 'record', kind: PAGE_KIND[page] })}><Plus size={19} />{{ ledger: '记一笔', tasks: '添加待办', health: '记录体重' }[page]}</button></div></div>
        {page !== 'ledger' && <PendingSection />}
        {page === 'ledger' && <Ledger userId={state.user.id} view={ledgerView} setView={setLedgerView} debtCreateSignal={debtCreateSignal} records={state.records} pending={<PendingSection />} onEdit={record => setModal(record.source === 'debt-repayment' ? { type: 'debts', billId: record.payload.debtBillId } : { type: 'record', record })} onDelete={safe(remove)} onTrash={() => openTrash('expense')} onError={notify} onNotify={notify} onDebtChange={result => {
          acceptState(result);
          if (call.current?.ready) call.current.send({ type: 'app.refresh_context' });
        }} />}
        {page === 'health' && <><h2 className="health-subtitle">体重记录</h2><div className="weight-overview"><div><span>最近一次</span><strong>{weights[0]?.payload.kg || '—'}<small>kg</small></strong></div><div><span>记录次数</span><strong>{weights.length}<small>次</small></strong></div><div><span>与上次相比</span><strong>{weights.length > 1 ? `${(weights[0].payload.kg - weights[1].payload.kg).toFixed(1)}` : '—'}<small>kg</small></strong></div></div>
          {weights.length >= 2 && <WeightChart records={weights} />}
          <p className="health-note"><Heart size={15} /> 体重会自然波动，记录不等于评价自己。</p><section className="record-list">{weights.length ? weights.map(record => <div className="ledger-row" key={record.id}><span className="record-icon blue"><Scale size={18} /></span><div className="row-main"><strong>{record.payload.date}</strong><small>体重记录</small></div><strong>{record.payload.kg} <small className="muted">kg</small></strong><IconButton icon={Trash2} label="删除体重记录" onClick={safe(() => remove(record))} /></div>) : <Empty icon={Scale} title="从一次记录开始" detail="慢慢了解自己的变化。" />}</section></>}
      </main>}
      {page === 'mine' && mineView === 'home' && <MinePage user={state.user} records={state.records}
        onMessages={() => { setMineView('messages'); window.scrollTo({ top: 0 }); }}
        onLedger={() => setPage('ledger')}
        onSettings={() => { setMineView('settings'); window.scrollTo({ top: 0 }); }}
        onAssistant={() => { setMineView('assistant'); window.scrollTo({ top: 0 }); }} onPrivacy={() => setModal({ type: 'privacy' })}
        onService={service => setModal({ type: 'account-service', service })}
        onAccount={() => setModal({ type: 'account-settings' })}
        onNotify={notify}
        onUsage={async () => { try { setUsage(await request('/usage')); setModal({ type: 'usage' }); } catch (error) { notify(error.message); } }} />}
      {page === 'mine' && mineView === 'messages' && <SystemMessages key={state.user.id} userId={state.user.id} onBack={() => { setMineView('home'); window.scrollTo({ top: 0 }); }} />}
      {page === 'mine' && mineView === 'assistant' && <main className="preferences-page assistant-settings-page">
        <header className="preferences-heading"><IconButton icon={ArrowLeft} label="返回我的" onClick={() => { setMineView('home'); window.scrollTo({ top: 0 }); }} /><h1>我的助手</h1><span /></header>
        <div className="assistant-settings-content">
        <section className="settings-group"><button className="setting-row" onClick={openAssistant}><MessageCircle size={20} /><span>打开助手</span><ChevronRight size={18} /></button><button className="setting-row" onClick={toggleDesktopAssistant}><PanelsTopLeft size={20} /><span>桌面悬浮助手</span><small>{desktopEnabled ? '已开启' : '未开启'}</small><ChevronRight size={18} /></button></section>
        <section className="settings-group"><h2>助手设置</h2><button className="setting-row" aria-label="切换助手性格" onClick={() => setModal({ type: 'persona' })}><Avatar persona={state.user.persona} size="small" /><span>{persona.name} · {persona.label}</span><ChevronRight size={18} /></button>
          <button className="setting-row" onClick={() => setModal({ type: 'memories' })}><History size={20} /><span>我们记得的事</span><small>{state.memories.length} 条</small><ChevronRight size={18} /></button>
          <div className="setting-row"><Heart size={20} /><span>关系模式</span><select aria-label="关系模式" value={state.user.relationship} disabled={!state.user.adult || Boolean(callStatus)} onChange={safe(e => profile({ relationship: e.target.value }))}><option value="friend">朋友</option>{state.user.adult && <option value="romance">亲密陪伴</option>}</select></div>
        </section>
        <section className="settings-group"><h2>关心，也要有分寸</h2><label className="setting-row"><Bell size={20} /><span>主动关心</span><input className="switch" type="checkbox" checked={Boolean(state.user.proactive)} onChange={safe(e => profile({ proactive: e.target.checked }))} /></label>
          <button className="setting-row" onClick={safe(() => profile(state.user.quiet_until && Date.parse(state.user.quiet_until) > Date.now() ? { resume: true } : { pause: true }))}><BellOff size={20} /><span>今天想安静一点</span><small>{state.user.quiet_until && Date.parse(state.user.quiet_until) > Date.now() ? '已暂停，点击恢复' : '暂停关心 24 小时'}</small><ChevronRight size={18} /></button>
          <div className="setting-note">每天最多主动关心 3 次，至少间隔 3 小时；21:00–08:00 不打扰。你设置的到点提醒照常。</div>
        </section>
        </div>
      </main>}
      {page === 'mine' && mineView === 'settings' && <SettingsMenu Modal={Modal} onBack={() => { setMineView('home'); window.scrollTo({ top: 0 }); }} onAccount={() => setModal({ type: 'account-settings' })} onTrash={() => openTrash()} onReminder={() => setModal({ type: 'record', kind: 'task' })} onNotify={notify}>
        <section className="settings-group"><button className="setting-row danger" onClick={logout}><LogOut size={20} /><span>退出登录</span></button></section>
      </SettingsMenu>}
    </div>
    <nav className="mobile-nav" aria-label="主要功能">{NAVIGATION.map(([id, Icon, label], index) => <React.Fragment key={id}>
      {index === 2 && <button className="nav-create" aria-label={page === 'ledger' && ledgerView === 'debt' ? '新增借款' : { ledger: '记一笔', tasks: '添加待办', health: '记录体重' }[page] || '新建记录'} title={page === 'ledger' && ledgerView === 'debt' ? '新增借款' : { ledger: '记一笔', tasks: '新建日程', health: '记录体重' }[page] || '新建记录'} onClick={() => page === 'ledger' && ledgerView === 'debt' ? setDebtCreateSignal(value => value + 1) : page === 'tasks' ? setPlannerCreateSignal(value => value + 1) : setModal({ type: 'record-kind', scope: page })}><Plus size={30} /></button>}
      <button aria-label={label} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={22} /><span>{label}</span>{badgeCount(id) > 0 && <i aria-label={`${badgeCount(id)} 条待查看`} />}</button>
    </React.Fragment>)}</nav>
    {modal?.type === 'account-service' && <AccountService type={modal.service} Modal={Modal} user={state.user} onClose={() => setModal(null)} onPasswordChanged={() => { if (call.current) endCall(); }} />}
    {modal?.type === 'account-settings' && <AccountSettings Modal={Modal} user={state.user} onClose={() => setModal(null)}
      onSaved={user => {
        setState(previous => ({ ...previous, user }));
        if (call.current?.ready) call.current.send({ type: 'app.refresh_context' });
      }}
      onLogout={logout} onPasswordChanged={() => { if (call.current) endCall(); }} />}
    {modal?.type === 'repayment-review' && <DebtRepaymentReview Modal={Modal} record={modal.record} onClose={() => setModal(null)}
      onReload={safe(async () => { await refresh(); setModal(null); })}
      onConfirm={async (record, body) => {
        const result = await action(`/records/${record.id}/confirm-debt`, { method: 'POST', body }, '还款已确认，原欠条与收入已同步更新');
        setModal({ type: 'debts', billId: result.debtBillId });
      }} />}
    {modal?.type === 'record' && !modal.record?.payload.receipt && <RecordForm kind={modal.kind} initial={modal.record} defaults={modal.defaults} onSave={saveRecord} onClose={() => setModal(null)} onDebt={() => setModal({ type: 'debts', receivableOnly: true })} />}
    {modal?.type === 'debts' && <DebtManager Modal={Modal} initialBillId={modal.billId} receivableOnly={modal.receivableOnly} onClose={() => setModal(null)} onChange={result => {
      acceptState(result);
      if (call.current?.ready) call.current.send({ type: 'app.refresh_context' });
    }} />}
    {(modal?.type === 'receipt' || (modal?.type === 'record' && modal.record?.payload.receipt)) && <ReceiptModal Modal={Modal} initial={modal.record} onSave={saveRecord} onClose={() => setModal(null)} />}
    {modal?.type === 'pending' && <Modal title="待确认记录" onClose={() => setModal(null)}><PendingSection scope="chat" /></Modal>}
    {modal?.type === 'record-kind' && <AddMenu Modal={Modal} title={{ ledger: '添加记账', health: '添加健康记录' }[modal.scope] || '添加'} onClose={() => setModal(null)}
      options={[
        ...[['expense', Wallet, '记一笔'], ['task', ListChecks, '添加待办'], ['weight', Scale, '记录体重']]
          .filter(([kind]) => !['ledger', 'health'].includes(modal.scope) || kind === PAGE_KIND[modal.scope])
          .map(([kind, icon, label]) => ({ label, icon, onSelect: () => setModal({ type: 'record', kind }) })),
        ...(modal.scope === 'health' ? [] : [{ label: '小票识别', icon: Camera, onSelect: () => setModal({ type: 'receipt' }) }]),
        ...(modal.scope === 'mine' ? [{ label: '新建课程', icon: GraduationCap, onSelect: () => { setModal(null); setPlannerCourseCreate({ at: Date.now() }); setPage('tasks'); } }] : []),
      ]} />}
    {modal?.type === 'batch' && <Modal title="批量核对账目" wide onClose={() => setModal(null)}><BatchReview records={pending} onReload={refresh} onConfirm={items => action('/records/confirm-batch', { method: 'POST', body: { items } }, `已确认保存 ${items.length} 笔`)} onClose={() => setModal(null)} /></Modal>}
    {modal?.type === 'trash' && <Modal title="记录回收站" onClose={() => setModal(null)}>{trash.length ? trash.map(record => <div className="memory-row" key={record.id}><div><p>{record.payload.title}</p><small>{record.payload.date}{record.kind === 'expense' ? ` · ¥${money(record.payload.cents)}` : ''} · {record.status === 'pending' ? '草稿' : record.status === 'confirmed' ? '已确认' : '已忽略'}</small></div><IconButton icon={RotateCcw} label={`恢复${record.payload.title}`} onClick={safe(async () => {
      const result = await action(`/records/${record.id}/restore`, { method: 'POST' }, '已恢复记录');
      setTrash(previous => previous.filter(r => r.id !== record.id));
      if (record.kind === 'task') syncReminders(result.records, true).catch(error => notify(error.message));
    })} /></div>) : <Empty icon={Trash2} title="回收站是空的" detail="" />}</Modal>}
    {modal?.type === 'persona' && <Modal title="今天，谁来陪你？" onClose={() => setModal(null)}><div className="persona-list">{Object.entries(PERSONAS).map(([id, value]) => <button key={id} className={state.user.persona === id ? 'selected' : ''} onClick={safe(async () => { await profile({ persona: id }); setModal(null); })}><Avatar persona={id} /><div><strong>{value.name}<small>{value.label}</small></strong><p>{value.detail}</p></div>{state.user.persona === id ? <Check size={20} /> : <ChevronRight size={18} />}</button>)}</div><p className="modal-hint">换一种相处方式，共同的记忆不会清空。</p></Modal>}
    {modal?.type === 'memories' && <Modal title="我们记得的事" onClose={() => setModal(null)}>{state.memories.length ? state.memories.map(memory => <div className="memory-row" key={memory.id}><div><p>{memory.text}</p><small>{new Date(memory.created).toLocaleDateString('zh-CN')}</small></div><IconButton icon={Trash2} label="删除这条记忆" onClick={safe(async () => { if (window.confirm('删除这条记忆？原聊天内容仍会保留。')) await action(`/memories/${memory.id}`, { method: 'DELETE' }); })} /></div>) : <Empty icon={History} title="慢慢了解你" detail="助手记住的偏好和约定会出现在这里。" />}<button className="text-button danger" onClick={safe(async () => { if (window.confirm('清空全部聊天与记忆？记账、待办和体重记录会保留，此操作无法撤销。')) { await action('/history', { method: 'DELETE' }); setModal(null); } })}>清空聊天与记忆</button></Modal>}
    {modal?.type === 'usage' && <Modal title="算力用量" onClose={() => setModal(null)}><div className="usage-list">{usage?.usage.map(item => <div key={item.kind}><span>{item.kind === 'text' ? '文字模型响应' : '语音模型响应'}</span><strong>{item.count} 次</strong></div>)}</div><p className="modal-hint">目前使用内测服务，未开放充值、扣费或支付订单。调用次数不等于费用。</p></Modal>}
    {modal?.type === 'privacy' && <Modal title="隐私与内测说明" onClose={() => setModal(null)}><div className="privacy-copy"><p>你对话的是 AI，而不是真人。亲密模式不会改变工具权限，也不会阻止你暂停或离开。</p><p>通话会向已配置的 AI 服务实时传送声音；本 App 不保存原始录音，会保存文字转录。上游服务的数据政策另行适用。</p><p>记录、对话和记忆保存在私有后端。当前版本采用自填生日限制关系模式，不是正式年龄核验。</p><p>安卓待办提醒需要系统通知权限；系统节电策略可能造成延迟。主动关心在服务运行时生成，App 关闭时暂不推送 AI 消息。</p><p>当前为局域网内测版，不适合公网部署或录入敏感信息，正式开放前需完成 HTTPS、年龄核验和数据管理。</p></div></Modal>}
    {!overlaySession && edgeVisible && !assistantOpen && <AssistantEdge onOpen={openAssistant} active={Boolean(callStatus)} unread={unreadCheckins} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div></PreferencesProvider></LockBoundary>;
}

function WeightChart({ records }) {
  const values = records.slice(0, 14).reverse();
  const max = Math.max(...values.map(r => r.payload.kg)) + 1;
  const min = Math.min(...values.map(r => r.payload.kg)) - 1;
  const points = values.map((r, i) => `${20 + i / Math.max(1, values.length - 1) * 560},${120 - (r.payload.kg - min) / (max - min) * 100}`);
  return <figure className="weight-chart"><figcaption>最近 {values.length} 次记录</figcaption><svg viewBox="0 0 600 150" role="img" aria-label={`体重趋势，从 ${values[0].payload.kg} 到 ${values.at(-1).payload.kg} 千克`}><line x1="20" y1="120" x2="580" y2="120" stroke="#e3e9e6" /><polyline points={points.join(' ')} fill="none" stroke="#3f806d" strokeWidth="2.5" strokeLinejoin="round" />{points.map((point, index) => <circle key={index} cx={point.split(',')[0]} cy={point.split(',')[1]} r="4" fill="#3f806d" />)}</svg><div><span>{values[0].payload.date}</span><span>{values.at(-1).payload.date}</span></div></figure>;
}

createRoot(document.getElementById('root')).render(<App />);
