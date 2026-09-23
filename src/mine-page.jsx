import React from 'react';
import { Settings2, Wallet, ChevronRight, ShieldCheck, Sparkles, CircleHelp, MessageSquare, Info, Bell, Copy } from 'lucide-react';
import { APP_VERSION } from './account-services';
import { UserAvatar } from './user-avatar';
import './mine-page.css';

export function MinePage({ user, records, onSettings, onLedger, onAssistant, onUsage, onPrivacy, onService, onAccount, onMessages, onNotify }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const entries = records.filter(item => item.kind === 'expense' && item.status === 'confirmed' && !item.deleted_at && item.payload.date && item.payload.date <= today);
  const days = new Set(entries.map(item => item.payload.date));
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const groups = [
    [[Wallet, '我的账本', onLedger], [Sparkles, '我的助手', onAssistant]],
    [[Settings2, '设置', onSettings], [Wallet, '算力用量', onUsage], [CircleHelp, '使用帮助', () => onService('help')], [MessageSquare, '意见反馈', () => onService('feedback')], [ShieldCheck, '隐私与内测说明', onPrivacy], [Info, '版本号', () => onService('version')]],
  ];
  async function copyAccountId() {
    const value = String(user.id || '');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea');
        input.value = value; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.appendChild(input); input.select();
        if (!document.execCommand('copy')) throw new Error('copy unavailable');
        input.remove();
      }
      onNotify?.('ID 已复制');
    } catch { onNotify?.('复制失败，请长按 ID 复制'); }
  }
  return <main className="mine-home">
    <header className="mine-page-heading"><h1>我的</h1><button className="icon-button mine-messages-entry" aria-label="消息" title="消息" onClick={onMessages}><Bell size={21} /></button></header>
    <section className="mine-hero">
      <div className="mine-identity"><button type="button" className="mine-avatar-entry" aria-label="账号设置" title="账号设置" onClick={onAccount}><UserAvatar user={user} className="mine-avatar" /></button><div className="mine-identity-copy"><h2>{user.name}</h2><button type="button" className="mine-account-id" title="复制 ID" aria-label="复制 ID" onClick={copyAccountId}><span>ID：{user.id}</span><Copy size={15} aria-hidden="true" /></button></div></div>
      <div className="mine-statistics" aria-label="我的记账统计">
        {[[streak, '连续记账'], [days.size, '记账天数'], [entries.length, '记账笔数']].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
    </section>
    <div className="mine-menu-scroll">
    {groups.map((rows, index) => <section className="mine-menu" aria-label={index ? '账户与服务' : '我的工具'} key={index}>
      {rows.map(([Icon, label, action]) => <button className="mine-menu-row" key={label} onClick={action}><Icon size={21} /><span>{label}</span>{label === '算力用量' && <small>内测</small>}{label === '版本号' && <small>{APP_VERSION}</small>}<ChevronRight size={17} /></button>)}
    </section>)}
    <footer className="mine-version"><img src="/app-icon.png" alt="" /><span>在在 · 内测版 {APP_VERSION}</span></footer>
    </div>
  </main>;
}
