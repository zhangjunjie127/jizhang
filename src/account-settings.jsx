import React, { useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, ImagePlus, LoaderCircle, LogOut } from 'lucide-react';
import { request } from './api';
import { UserAvatar } from './user-avatar';
import { AccountDeletion } from './account-deletion';
import { PasswordForm } from './account-services';
import './account-settings.css';

const GENDERS = { '': '保密', male: '男', female: '女' };
const BINDINGS = {
  phone: { label: '手机号绑定', message: '短信验证服务尚未配置，暂不支持绑定手机号。开通后需通过短信验证码验证。' },
  wechat: { label: '微信绑定', message: '微信开放平台尚未接入，暂不支持绑定微信。开通后需通过微信授权。' },
  email: { label: '邮箱绑定', message: '邮件验证服务尚未配置，暂不支持绑定邮箱。开通后需通过邮件验证。' },
};

async function avatarImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片超过 12MB，请选择较小的图片');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('图片无法读取，请重新选择'); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理图片，请重试');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 256, 256);
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const image = canvas.toDataURL('image/jpeg', .85);
    if (image.length > 128 * 1024) throw new Error('图片过大，请选择较简单的图片');
    return image;
  } finally { bitmap.close(); }
}

export function AccountSettings({ Modal, user, onClose, onSaved, onLogout, onPasswordChanged }) {
  const [screen, setScreen] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const sheetRef = useRef(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [avatarDraft, setAvatarDraft] = useState(null);
  useEffect(() => {
    if (!avatarOpen && !genderOpen && !nameOpen) return;
    const previous = document.activeElement;
    sheetRef.current?.querySelector(nameOpen ? 'input' : 'button')?.focus();
    return () => previous?.focus();
  }, [avatarOpen, genderOpen, nameOpen]);
  useEffect(() => {
    if (!nameOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const sync = () => {
      const modal = sheetRef.current?.closest('.modal');
      setKeyboardInset(modal ? Math.max(0, modal.getBoundingClientRect().bottom - viewport.height - viewport.offsetTop) : 0);
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, [nameOpen]);
  const dirty = draft.trim() !== (user.name || '');
  function closeAvatar() {
    if (busy || (avatarDraft !== null && !window.confirm('放弃尚未保存的头像？'))) return;
    setAvatarOpen(false); setAvatarDraft(null); setError('');
  }
  function closeSheet() {
    if (avatarOpen) { closeAvatar(); return; }
    if (busy) return;
    sheetRef.current?.querySelector('input')?.blur();
    setNameOpen(false); setGenderOpen(false); setError('');
  }
  function leave(close = false) {
    if (avatarOpen || genderOpen || nameOpen) { closeSheet(); return; }
    if (busy) return;
    setError('');
    if (close || !screen) onClose();
    else setScreen('');
  }
  function edit(field) {
    setDraft(user[field] || ''); setScreen(field); setError(''); setSaved('');
  }
  async function save(event) {
    event.preventDefault();
    if (busy || !draft.trim() || !dirty) return;
    setBusy(true); setError('');
    try {
      const result = await request('/account/profile', { method: 'PATCH', body: { name: draft.trim() } });
      onSaved(result.user);
      sheetRef.current?.querySelector('input')?.blur();
      setNameOpen(false); setSaved('昵称已保存');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true); setError('');
    try { setAvatarDraft(await avatarImage(file)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveAvatar() {
    if (busy || avatarDraft === null) return;
    setBusy(true); setError('');
    try {
      const result = await request('/account/profile', { method: 'PATCH', body: { avatar: avatarDraft } });
      onSaved(result.user); setAvatarOpen(false); setAvatarDraft(null); setSaved('头像已保存');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function saveGender(gender) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await request('/account/profile', { method: 'PATCH', body: { gender } });
      onSaved(result.user); setGenderOpen(false); setSaved('性别已保存');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const title = BINDINGS[screen]?.label || { password: '密码设置', logout: '退出登录', deletion: '申请注销' }[screen] || '账号设置';
  return <Modal title={title} fullScreen className="account-settings-modal" onBack={() => leave()} onClose={() => leave(true)}>
    <div className="account-settings-content" inert={avatarOpen || genderOpen || nameOpen ? true : undefined}>
      {!screen && <>
        <section className="account-settings-group" aria-label="账号资料">
          <button className="account-settings-row avatar-row" onClick={() => { setAvatarOpen(true); setAvatarDraft(null); setError(''); setSaved(''); }}><span>头像</span><UserAvatar user={user} className="account-settings-avatar" /><ChevronRight size={18} /></button>
          <div className="account-settings-row"><span>ID</span><span className="account-id">{user.id}</span></div>
          <button className="account-settings-row" onClick={() => { setDraft(user.name || ''); setKeyboardInset(0); setNameOpen(true); setError(''); setSaved(''); }}><span>昵称</span><span className="account-settings-value">{user.name}</span><ChevronRight size={18} /></button>
          <button className="account-settings-row" onClick={() => { setGenderOpen(true); setError(''); setSaved(''); }}><span>性别</span><span className="account-settings-value">{GENDERS[user.gender || '']}</span><ChevronRight size={18} /></button>
        </section>
        <section className="account-settings-group" aria-label="登录信息">
          <div className="account-settings-row"><span>登录账号</span><span className="account-settings-value">{user.username}</span></div>
          <button className="account-settings-row" onClick={() => edit('password')}><span>密码设置</span><ChevronRight size={18} /></button>
        </section>
        <section className="account-settings-group" aria-label="账号绑定">
          {Object.entries(BINDINGS).map(([key, binding]) => <button className="account-settings-row" key={key} onClick={() => edit(key)}><span>{binding.label}</span><span className="account-settings-value">暂未开通</span><ChevronRight size={18} /></button>)}
        </section>
        <section className="account-settings-group" aria-label="账号注销">
          <button className="account-settings-row" onClick={() => edit('deletion')}><span>申请注销</span><span className="account-settings-value">需管理员审核</span><ChevronRight size={18} /></button>
        </section>
        {saved && <p className="account-settings-saved" role="status">{saved}</p>}
        <button className="account-logout" onClick={() => edit('logout')}><LogOut size={18} />退出登录</button>
      </>}
      {screen === 'password' && <div className="account-editor"><PasswordForm user={user} busy={busy} setBusy={setBusy} onChanged={onPasswordChanged} /></div>}
      {BINDINGS[screen] && <div className="account-editor service-form"><h3>暂未开通</h3><p className="service-note">{BINDINGS[screen].message}</p><button className="secondary" onClick={() => setScreen('')}>返回账号设置</button></div>}
      {screen === 'deletion' && <AccountDeletion user={user} busy={busy} setBusy={setBusy} />}
      {screen === 'logout' && <div className="account-editor service-form">
        <h3>确认退出当前账号？</h3><p className="service-note">账号资料、账单和聊天记录会保留，重新登录后可继续使用。正在进行的通话会结束。</p>
        <button className="primary service-submit" disabled={busy} onClick={async () => {
          if (busy) return;
          setBusy(true);
          try { await onLogout(); }
          catch (err) { setError(err.message); setBusy(false); }
        }}>{busy ? '正在退出' : '确认退出登录'}</button>
        <button className="secondary" disabled={busy} onClick={() => setScreen('')}>取消</button>
        {error && <p className="error-box" role="alert">{error}</p>}
      </div>}
    </div>
    {(avatarOpen || genderOpen || nameOpen) && <div className={`avatar-sheet-backdrop${nameOpen ? ' nickname-backdrop' : ''}`} style={nameOpen ? { bottom: keyboardInset } : undefined} onMouseDown={event => { if (event.target === event.currentTarget) closeSheet(); }}>
      <section ref={sheetRef} className={`avatar-sheet${nameOpen ? ' nickname-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={nameOpen ? '修改昵称' : genderOpen ? '选择性别' : '更换头像'} onKeyDownCapture={event => {
        if (!['Escape', 'Tab'].includes(event.key) || event.isComposing) return;
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
        if (event.key === 'Tab') {
          const buttons = [...sheetRef.current.querySelectorAll('input:not([hidden]):not(:disabled),button:not(:disabled)')];
          if (!buttons.length) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
        }
      }}>
        {nameOpen ? <form className="nickname-form" onSubmit={save}>
          <h3>修改昵称</h3>
          <input aria-label="昵称" type="text" value={draft} required maxLength={24} readOnly={busy} onChange={event => setDraft(event.target.value)} autoComplete="nickname" enterKeyHint="done" />
          <small>{draft.length}/24</small>
          {error && <p className="error-box" role="alert">{error}</p>}
          <div className="nickname-actions">
            <button type="button" className="secondary" disabled={busy} onClick={closeSheet}>取消</button>
            <button className="primary" type="submit" disabled={busy || !dirty || !draft.trim()}>{busy ? '正在保存' : '保存'}</button>
          </div>
        </form> : <>
        {avatarOpen && <><input type="file" hidden ref={cameraInput} aria-label="拍摄头像" accept="image/*" capture="user" onChange={chooseImage} />
        <input type="file" hidden ref={fileInput} aria-label="选择头像图片" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} />
        {avatarDraft !== null && <div className="avatar-sheet-preview">
          <UserAvatar user={{ ...user, avatar: avatarDraft }} className="account-avatar-preview" />
          <button disabled={busy} className="primary" onClick={saveAvatar}>保存</button>
          {avatarDraft && <button disabled={busy} className="text-button" onClick={() => setAvatarDraft('')}>恢复默认头像</button>}
        </div>}</>}
        {error && <p className="error-box" role="alert">{error}</p>}
        {busy && <p className="avatar-sheet-status" role="status"><LoaderCircle size={18} className="spin" />正在处理</p>}
        {genderOpen ? <div className="avatar-sheet-options">
          {['male', 'female', ''].map(value => <button key={value} disabled={busy} aria-pressed={(user.gender || '') === value} onClick={() => saveGender(value)}>{GENDERS[value]}</button>)}
        </div> : <div className="avatar-sheet-options">
          <button disabled={busy} onClick={() => cameraInput.current.click()}><Camera size={21} />拍照</button>
          <button disabled={busy} onClick={() => fileInput.current.click()}><ImagePlus size={21} />从相册选择</button>
        </div>}
        <button disabled={busy} className="avatar-sheet-cancel" onClick={closeSheet}>取消</button>
        </>}
      </section>
    </div>}
  </Modal>;
}
