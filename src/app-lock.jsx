import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Delete, Fingerprint, Grid3x3, LockKeyhole, ShieldCheck } from 'lucide-react';
import { isNative, request } from './api';
import { NativeAppLock, lockStorage } from './app-lock-storage';
import { appendGesture, checkCredential, createCredential, emptyLock, failedAttempt, validSecret } from './app-lock-core.mjs';
import './app-lock.css';

const Context = createContext(null);
export const useAppLock = () => useContext(Context);
const labels = { pin: '密码解锁', gesture: '手势解锁' };

export function PinInput({ value, onChange, disabled }) {
  function key(valueToAdd) {
    if (disabled) return;
    onChange(valueToAdd === 'delete' ? value.slice(0, -1) : (value + valueToAdd).slice(0, 6));
  }
  return <div className="lock-pin" role="group" aria-label="六位解锁密码">
    <div className={`lock-pin-entry${disabled ? ' is-disabled' : ''}`}>
    <input aria-label="应用锁密码" type="password" inputMode="none" readOnly value={value} maxLength={6} disabled={disabled} onKeyDown={event => {
      if (/^\d$/.test(event.key) || event.key === 'Backspace') { event.preventDefault(); key(event.key === 'Backspace' ? 'delete' : event.key); }
    }} />
    <div className="lock-pin-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className={index === value.length && !disabled ? 'is-current' : ''}>{index < value.length && <i />}</span>)}</div>
    </div>
    <div className="lock-keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'].map((digit, index) => digit ? <button type="button" disabled={disabled} key={digit} aria-label={digit === 'delete' ? '删除一位密码' : digit} onClick={() => key(digit)}>{digit === 'delete' ? <Delete size={21} /> : digit}</button> : <span key={index} />)}</div>
  </div>;
}

export function GestureInput({ value, onChange, disabled }) {
  const drag = useRef(null);
  const current = useRef(value);
  current.current = value;
  function add(point) {
    current.current = appendGesture(current.current, point);
    onChange(current.current);
  }
  function position(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 300, y: (event.clientY - rect.top) / rect.height * 300 };
  }
  function hit(point) {
    for (let index = 0; index < 9; index++) {
      if (Math.hypot(point.x - (index % 3 * 100 + 50), point.y - (Math.floor(index / 3) * 100 + 50)) < 27) add(index);
    }
  }
  return <div className="lock-pattern-wrap">
    <div className="lock-pattern" role="group" aria-label="九宫格手势" onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      current.current = ''; onChange('');
      const point = position(event); drag.current = { ...point, id: event.pointerId }; hit(point);
    }} onPointerMove={event => {
      if (disabled || drag.current?.id !== event.pointerId) return;
      const next = position(event), previous = drag.current;
      const steps = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) / 8));
      for (let index = 1; index <= steps; index++) hit({ x: previous.x + (next.x - previous.x) * index / steps, y: previous.y + (next.y - previous.y) * index / steps });
      drag.current = { ...next, id: event.pointerId };
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; current.current = ''; onChange(''); }}>
      <svg viewBox="0 0 300 300" aria-hidden="true"><polyline points={[...value].map(Number).map(point => `${point % 3 * 100 + 50},${Math.floor(point / 3) * 100 + 50}`).join(' ')} /></svg>
      {Array.from({ length: 9 }, (_, index) => <button type="button" disabled={disabled} key={index} aria-label={`手势点${index + 1}`} aria-pressed={value.includes(String(index))} onClick={event => { if (event.detail === 0) add(index); }}><span /></button>)}
    </div>
    <button className="text-button" type="button" disabled={disabled || !value} onClick={() => { current.current = ''; onChange(''); }}>重新绘制</button>
  </div>;
}

export function AppLockProvider({ user, onLock, onLogout, children }) {
  const storage = useMemo(() => lockStorage(user.id), [user.id]);
  const [config, setConfig] = useState(null);
  const configRef = useRef(null);
  const [locked, setLocked] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [available, setAvailable] = useState({ available: false, reason: isNative ? '正在检查手机能力' : '网页预览不支持人脸验证，请使用密码或手势' });
  const generation = useRef(0);
  const lockCallback = useRef(onLock);
  lockCallback.current = onLock;
  function lock() {
    if (!configRef.current?.enabled) return;
    generation.current++;
    setLocked(true);
    lockCallback.current?.();
  }
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    let active = true, listener;
    storage.read().then(value => {
      if (!active) return;
      configRef.current = value; setConfig(value); setLocked(value.enabled);
      if (value.enabled) lockCallback.current?.();
    }).catch(error => { if (active) { setLoadError(error.message); configRef.current = { ...emptyLock(), enabled: true }; setConfig(configRef.current); } });
    if (isNative) {
      NativeAppLock.availability().then(result => { if (active) setAvailable(result); }).catch(() => { if (active) setAvailable({ available: false, reason: '无法使用系统验证，请使用密码或手势' }); });
      NativeAppLock.addListener('background', () => lockRef.current()).then(handle => { if (active) listener = handle; else handle.remove(); }).catch(() => {});
    }
    const visibility = () => { if (document.hidden) lockRef.current(); };
    const pageHide = () => lockRef.current();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    return () => {
      active = false; generation.current++;
      listener?.remove();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [storage]);
  async function save(next) {
    await storage.write(next);
    configRef.current = next; setConfig(next);
  }
  function current(epoch) {
    if (generation.current !== epoch || document.hidden) throw new Error('应用状态已变化，请重新验证');
  }
  async function accountPassword(password) {
    const result = await request('/account/app-lock/verify', { method: 'POST', body: { currentPassword: password } });
    if (result.verified !== true) throw new Error('账号验证未通过');
  }
  async function configure(mode, secret, password) {
    const epoch = generation.current;
    const credential = await createCredential(mode, secret);
    await accountPassword(password); current(epoch);
    await save({ ...configRef.current, [mode]: credential, enabled: true, failures: 0, blockedUntil: 0 });
    current(epoch);
  }
  async function reset(password) {
    const epoch = generation.current;
    await accountPassword(password); current(epoch);
    await save(emptyLock()); current(epoch);
    setLoadError(''); setLocked(false);
  }
  async function biometric(enabled, password) {
    if (!configRef.current?.enabled || (!configRef.current.pin && !configRef.current.gesture)) throw new Error('请先设置密码或手势作为备用方式');
    const epoch = generation.current;
    await accountPassword(password); current(epoch);
    if (enabled) {
      if (!isNative || !available.available) throw new Error(available.reason);
      const result = await NativeAppLock.authenticate();
      if (!result.verified) throw new Error('系统验证未通过');
      current(epoch);
    }
    await save({ ...configRef.current, biometric: enabled }); current(epoch);
  }
  async function unlock(mode, secret) {
    const epoch = generation.current, value = configRef.current;
    if (loadError) throw new Error(loadError);
    if (value.blockedUntil > Date.now()) throw new Error('尝试次数过多，请稍后再试');
    if (mode === 'biometric') {
      if (!isNative || !value.biometric || !available.available) throw new Error('系统验证不可用');
      const result = await NativeAppLock.authenticate();
      if (!result.verified) throw new Error('系统验证未通过');
    } else if (!await checkCredential(mode, secret, value[mode])) {
      current(epoch);
      const failed = failedAttempt(value);
      await save(failed);
      throw new Error(failed.blockedUntil ? '连续输错 5 次，请 60 秒后再试' : '验证不正确，请重试');
    }
    current(epoch);
    await save({ ...value, failures: 0, blockedUntil: 0 }); current(epoch);
    setLocked(false);
  }
  return <Context.Provider value={{ config, available, configure, reset, biometric, lock }}>
    {!config ? <div className="lock-loading" role="status">正在检查应用锁…</div> : locked ? <LockScreen key={generation.current} user={user} config={config} available={available} error={loadError} onUnlock={unlock} onReset={reset} onLogout={onLogout} /> : children}
  </Context.Provider>;
}

function LockScreen({ user, config, available, error: initialError, onUnlock, onReset, onLogout }) {
  const [mode, setMode] = useState(config.pin ? 'pin' : 'gesture');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [recover, setRecover] = useState(Boolean(initialError));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  const remaining = Math.max(0, Math.ceil((config.blockedUntil - now) / 1000));
  useEffect(() => {
    if (!config.blockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [config.blockedUntil]);
  async function run(action) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (err) { setError(err.message); setSecret(''); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className="app-lock-screen" aria-label="应用已锁定">
    <div className="lock-screen-inner"><img src="/app-icon.png" alt="在在" /><h1>应用已锁定</h1><p className="lock-account">{user.username}</p>
      {recover ? <form onSubmit={event => { event.preventDefault(); run(() => onReset(password)); }}>
        <h2>重置应用锁</h2><p>验证账号登录密码后，清除本机的解锁方式。账单和聊天记录保留，请随后重新设置应用锁。</p>
        <label>账号登录密码<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <button className="primary" disabled={busy || !password}>验证并重置应用锁</button>
        {!initialError && <button className="text-button" type="button" disabled={busy} onClick={() => { setRecover(false); setPassword(''); setError(''); }}>返回解锁</button>}
      </form> : <>
        <div className="lock-mode-tabs" role="group" aria-label="解锁方式">{['pin', 'gesture'].filter(value => config[value]).map(value => <button key={value} aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setSecret(''); setError(''); }}>{labels[value]}</button>)}</div>
        {mode === 'pin' ? <PinInput value={secret} onChange={setSecret} disabled={busy || remaining > 0} /> : <GestureInput value={secret} onChange={setSecret} disabled={busy || remaining > 0} />}
        <button className="primary lock-submit" disabled={busy || remaining > 0 || !validSecret(mode, secret)} onClick={() => run(() => onUnlock(mode, secret))}>{busy ? '正在验证' : '解锁'}</button>
        {config.biometric && <button className="secondary lock-biometric" disabled={busy || remaining > 0 || !available.available} onClick={() => run(() => onUnlock('biometric'))}><Fingerprint size={20} />人脸 / 系统验证</button>}
        {remaining > 0 && <p role="status">{remaining} 秒后可重试</p>}
        <button className="text-button" disabled={busy} onClick={() => { setRecover(true); setSecret(''); setError(''); }}>忘记密码或手势？</button>
      </>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <button className="text-button lock-logout" disabled={busy} onClick={() => { if (window.confirm('退出当前账号？本机应用锁设置和已有记录会保留。')) run(onLogout); }}>退出登录</button>
    </div>
  </main>;
}

export function AppLockSettings({ Modal, onClose }) {
  const lock = useAppLock();
  const [screen, setScreen] = useState('');
  const [first, setFirst] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  function open(value) { setScreen(value); setFirst(''); setSecret(''); setPassword(''); setError(''); }
  async function run(action) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); open(''); } catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }
  const config = lock.config;
  return <Modal title={screen === 'pin' ? '设置解锁密码' : screen === 'gesture' ? '设置手势' : '应用锁'} onClose={() => { if (!busy) onClose(); }} onBack={screen ? () => { if (!busy) open(''); } : undefined}>
    <div className="lock-settings">
      {!screen ? <>
        <p className="lock-status"><ShieldCheck size={20} />{config.enabled ? '已开启 · 打开或返回时验证' : '未开启'}</p>
        <button className="preferences-row" onClick={() => open('pin')}><LockKeyhole size={21} /><span>密码解锁</span><small>设置</small></button>
        <button className="preferences-row" onClick={() => open('gesture')}><Grid3x3 size={21} /><span>手势解锁</span><small>设置</small></button>
        <button className="preferences-row" disabled={!config.enabled || (!config.biometric && !lock.available.available)} onClick={() => open('biometric')}><Fingerprint size={21} /><span>人脸识别</span><small>设置</small></button>
        <p className="lock-note">{!isNative ? lock.available.reason : '使用手机系统认证，不采集人脸照片。系统可能选择指纹等方式；具体支持以手机为准。'}{!config.enabled && ' 请先设置密码或手势。'}</p>
        {config.enabled && <><button className="secondary" onClick={lock.lock}>立即锁定</button><button className="text-button" onClick={() => open('disable')}>关闭应用锁</button></>}
      </> : ['pin', 'gesture'].includes(screen) ? <form onSubmit={event => {
        event.preventDefault();
        if (!validSecret(screen, secret)) return;
        if (!first) { setFirst(secret); setSecret(''); setError(''); return; }
        if (secret !== first) { setError('两次输入不一致，请重新确认'); setSecret(''); return; }
        run(() => lock.configure(screen, secret, password));
      }}>
        <h3>{first ? '再次输入以确认' : screen === 'pin' ? '设置 6 位数字密码' : '连接至少 4 个不同的点'}</h3>
        {screen === 'pin' ? <PinInput value={secret} onChange={setSecret} disabled={busy} /> : <GestureInput value={secret} onChange={setSecret} disabled={busy} />}
        {first && <label>账号登录密码<input type="password" autoComplete="current-password" required value={password} maxLength={128} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>}
        <button className="primary" disabled={busy || !validSecret(screen, secret) || (Boolean(first) && !password)}>{busy ? '正在保存' : first ? '确认并启用' : '下一步'}</button>
      </form> : <form onSubmit={event => {
        event.preventDefault();
        run(() => screen === 'disable' ? lock.reset(password) : lock.biometric(!config.biometric, password));
      }}>
        <h3>{screen === 'disable' ? '确认关闭应用锁？' : config.biometric ? '关闭人脸验证' : '开启系统人脸验证'}</h3>
        <p>{screen === 'disable' ? '本机解锁方式将被清除，账号和已有记录保留。' : '验证账号密码后，开启时还需通过手机系统验证。'}</p>
        <label>账号登录密码<input type="password" autoComplete="current-password" maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
        <button className="primary" disabled={busy || !password}>{busy ? '正在验证' : '确认'}</button>
      </form>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <p className="lock-note">应用锁仅保护本机界面，不替代账号登录和数据加密。</p>
    </div>
  </Modal>;
}
