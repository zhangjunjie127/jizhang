import React, { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, ShieldCheck } from 'lucide-react';
import { request } from './api';
import { requestId } from './navigation';
import packageInfo from '../package.json';
import './account-services.css';

export const APP_VERSION = packageInfo.version;
const titles = { help: '使用帮助', feedback: '意见反馈', version: '版本说明' };
const help = [
  ['如何记一笔账？', '点击底部加号，选择支出或收入，再选择类别并填写金额、日期和备注。保存后可在明细页查看。'],
  ['如何查看某月或某天的账目？', '在明细页点击日历图标，滚动选择年、月、日，再点确定。日选项中的“整月”表示查看整个月；筛选按钮可选择收支和分类。'],
  ['助手生成的记录会直接入账吗？', '助手生成的草稿需要你核对确认。涉及修改或删除等操作时，请先检查操作确认中的内容，再决定是否执行。'],
  ['小票如何入账？', '在助手对话中点击相机图标上传小票，核对识别的金额与商品明细后保存。整张小票作为一笔账，点开可查看商品明细。'],
  ['收到部分还款怎么记？', '进入记账页的债务栏目，找到对应往来人和原欠条，登记本次还款的金额、实际日期及说明。系统更新剩余欠款并保留还款明细，原约定还款日不变。'],
  ['误删记录怎么办？', '打开“我的”中的回收站查看可恢复记录。债务还款涉及关联账单，请进入原欠条处理，避免重复记录。'],
  ['为什么没有收到提醒？', '先检查待办是否设置了未来的提醒时间，以及安卓系统是否允许本应用发送通知。网页预览不能代替安卓系统通知；当前内测版在应用关闭时暂不推送助手主动消息。'],
  ['忘记密码或无法连接怎么办？', '当前可在账号设置的密码设置中验证原密码后修改密码，暂不支持短信或邮箱找回。忘记密码需联系内测管理员；无法连接时请检查手机网络及登录页的服务地址。'],
];

export function AccountService({ type, Modal, user, onClose, onPasswordChanged }) {
  const [busy, setBusy] = useState(false);
  return <Modal title={titles[type]} fullScreen onClose={busy ? () => {} : onClose}>
    <div className="account-service">
      {type === 'feedback' && <FeedbackForm busy={busy} setBusy={setBusy} />}
      {type === 'help' && <section className="service-help" aria-label="常见问题">{help.map(([title, text]) => <details key={title}><summary>{title}</summary><p>{text}</p></details>)}</section>}
      {type === 'version' && <section className="service-version">
        <img src="/app-icon.png" alt="在在" /><h3>在在</h3><p>版本 {APP_VERSION} · 邀请制内测</p>
        <h4>当前版本</h4>
        <ul><li>记账明细、月账单、年账单与个人债务管理</li><li>文字及语音助手，小票识别与待确认记录</li><li>待办提醒、体重记录与助手记忆</li><li>账户密码修改、帮助与意见反馈</li></ul>
        <p className="service-note">当前未开放付费购买或应用内自动更新。安装包更新由内测管理员提供。</p>
      </section>}
    </div>
  </Modal>;
}

export function PasswordForm({ user, busy, setBusy, onChanged }) {
  const [fields, setFields] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError(''); setSuccess(false);
    if (fields.newPassword !== fields.confirmPassword) { setError('两次新密码不一致'); return; }
    setBusy(true);
    try {
      await request('/account/password', { method: 'POST', body: fields });
      setFields({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccess(true);
      onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <form className="service-form" onSubmit={submit}>
    <div className="service-account"><ShieldCheck size={24} /><div><strong>{user.username}</strong><span>当前登录账户</span></div></div>
    <h3>修改密码</h3>
    <fieldset disabled={busy}>
      {[['currentPassword', '当前密码', 'current-password'], ['newPassword', '新密码', 'new-password'], ['confirmPassword', '确认新密码', 'new-password']].map(([key, label, complete]) => <label key={key}>{label}<input type="password" autoComplete={complete} required minLength={key === 'currentPassword' ? 1 : 10} maxLength={128} value={fields[key]} onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
    </fieldset>
    <p className="service-note">新密码为 10–128 位。修改后本机保持登录，其他登录会话失效，正在进行的语音通话会结束。</p>
    {error && <p className="error-box" role="alert">{error}</p>}
    {success && <p className="service-success" role="status"><Check size={18} />密码已修改，其他登录会话已撤销。</p>}
    <button className="primary service-submit" disabled={busy} type="submit">{busy && <LoaderCircle size={18} className="spin" />}{busy ? '正在修改' : '确认修改密码'}</button>
  </form>;
}

function FeedbackForm({ busy, setBusy }) {
  const [category, setCategory] = useState('问题反馈');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [items, setItems] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const submission = useRef(null);
  async function load(signal) {
    setLoading(true); setHistoryError('');
    try { const result = await request('/feedback', { signal }); setItems(result.items); }
    catch (err) { if (err.name !== 'AbortError') setHistoryError(err.message); }
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
    setError(''); setSuccess('');
    const payload = { category, content: content.trim(), contact: contact.trim() };
    if (payload.content.length < 5) { setError('反馈内容至少填写 5 个字'); return; }
    const signature = JSON.stringify(payload);
    if (submission.current?.signature !== signature) submission.current = { signature, id: requestId() };
    setBusy(true);
    try {
      const result = await request('/feedback', { method: 'POST', body: { ...payload, requestId: submission.current.id } });
      setSuccess(`反馈已保存，编号 ${result.id.slice(0, 8)}`);
      setContent(''); setContact(''); submission.current = null;
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <form className="service-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>反馈类型<select aria-label="反馈类型" value={category} onChange={event => setCategory(event.target.value)}>{['问题反馈', '功能建议', '其他'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>反馈内容<textarea aria-label="反馈内容" rows={5} required minLength={5} maxLength={1000} value={content} onChange={event => setContent(event.target.value)} placeholder="请描述遇到的问题或建议" /></label>
        <span className="service-count">{content.length} / 1000</span>
        <label>联系方式（选填）<input type="text" maxLength={100} autoComplete="off" value={contact} onChange={event => setContact(event.target.value)} placeholder="邮箱或其他联系方式" /></label>
      </fieldset>
      <p className="service-note">反馈只保存到本应用服务，不会自动上传账单或聊天。请勿填写密码、密钥等敏感信息。</p>
      {error && <p className="error-box" role="alert">{error}</p>}
      {success && <p className="service-success" role="status"><Check size={18} />{success}</p>}
      <button className="primary service-submit" type="submit" disabled={busy}>{busy && <LoaderCircle size={18} className="spin" />}{busy ? '正在提交' : '提交反馈'}</button>
    </form>
    <section className="feedback-history" aria-label="我的反馈"><h3>我的反馈</h3>
      {loading ? <p role="status">正在加载</p> : historyError ? <div><p role="alert">{historyError}</p><button className="text-button" disabled={busy} onClick={() => load()}>重新加载反馈</button></div> : !items.length ? <p className="service-note">暂无反馈记录</p> : items.map(item => <article key={item.id}><header><strong>{item.category}</strong><span>已提交</span></header><p>{item.content}</p><small>{new Date(item.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {item.id.slice(0, 8)}</small></article>)}
    </section>
  </>;
}
