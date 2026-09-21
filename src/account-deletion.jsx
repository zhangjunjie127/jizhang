import React, { useEffect, useState } from 'react';
import { request } from './api';

export function AccountDeletion({ user, busy, setBusy }) {
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [review, setReview] = useState(false);
  async function load(signal) {
    setLoading(true); setLoadError('');
    try { const result = await request('/account/deletion', { signal }); setApplication(result.application); }
    catch (err) { if (err.name !== 'AbortError') setLoadError(err.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!review) { setReview(true); setError(''); return; }
    setBusy(true); setError('');
    try {
      const result = await request('/account/deletion', { method: 'POST', body: { currentPassword: password, acknowledged, confirmation: '申请注销' } });
      setApplication(result.application); setPassword(''); setAcknowledged(false); setReview(false);
    } catch (err) { setError(err.message); setReview(false); }
    finally { setBusy(false); }
  }
  if (loading) return <p className="account-editor" role="status">正在查询申请状态</p>;
  if (loadError) return <div className="account-editor service-form"><p className="error-box" role="alert">{loadError}</p><button className="secondary" onClick={() => load()}>重新查询</button></div>;
  return <div className="account-editor service-form">
    <h3>{application?.status === 'pending' ? '注销申请待审核' : '申请注销账号'}</h3>
    {application && <p className="service-note" role="status">{({ pending: '申请已提交，账号尚未注销。', cancelled: '上一份申请已撤回。', rejected: '上一份申请未通过审核。' })[application.status]}{application.reason && `原因：${application.reason}`}<br />申请时间：{new Date(application.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
    <p className="service-note">审核通过后，将删除本应用当前数据库中的账号、账单、债务、待办、体重、聊天、记忆、反馈和登录状态，不能在应用内恢复。历史备份由管理员另行处理。</p>
    {application?.status === 'pending' ? <>
      <p className="service-note">等待管理员审核期间仍可使用账号，也可撤回申请。</p>
      <button className="secondary" disabled={busy} onClick={async () => {
        if (busy) return;
        setBusy(true); setError('');
        try { const result = await request('/account/deletion/cancel', { method: 'POST', body: { id: application.id } }); setApplication(result.application); }
        catch (err) { setError(err.message); }
        finally { setBusy(false); }
      }}>{busy ? '正在处理' : '撤回注销申请'}</button>
      <button className="text-button" disabled={busy} onClick={() => load()}>刷新申请状态</button>
    </> : <form className="service-form" onSubmit={submit}>
      {!review ? <fieldset disabled={busy}>
        <label>当前密码<input type="password" aria-label="注销验证密码" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="account-deletion-consent"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>我已了解注销后果，申请由管理员审核。</span></label>
        <button className="primary service-submit" type="submit">下一步</button>
      </fieldset> : <>
        <p className="account-deletion-confirm">确认提交账号 <strong>{user.username}</strong> 的注销申请？</p>
        <p className="service-note">提交时会验证当前密码；此操作仅创建申请，不会立即删除账号。</p>
        <button className="primary service-submit" type="submit" disabled={busy}>{busy ? '正在提交' : '确认提交注销申请'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setReview(false)}>返回修改</button>
      </>}
    </form>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </div>;
}
