import React, { useState } from 'react';
import { ArrowLeft, Calculator, Tags, Users, Wallet, Scale, Percent, Landmark, GraduationCap, Star, Plus, Trash2, Copy, RotateCcw, PanelsTopLeft } from 'lucide-react';
import { calculateTool } from '../shared/calculators.mjs';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { DateInput } from './date-picker';
import { DesktopWidgetSettings } from './desktop-widgets';
import './calculator-tools.css';

const tools = [
  { id: 'basic', name: '普通计算', group: '日常计算', icon: Calculator },
  { id: 'discount', name: '折扣计算', group: '日常计算', icon: Tags, fields: [['price', '原价 / 元'], ['discount', '折扣 / 折', '8.5'], ['reduction', '折后优惠 / 元（选填）']] },
  { id: 'split', name: '费用分摊', group: '日常计算', icon: Users, fields: [['total', '总费用 / 元'], ['people', '人数']] },
  { id: 'salary', name: '工资计算', group: '工资费用', icon: Wallet, fields: [['salary', '税前月薪 / 元'], ['social', '个人社保 / 月（选填）', '0'], ['fund', '个人公积金 / 月（选填）', '0'], ['special', '专项附加扣除 / 月（选填）', '0']] },
  { id: 'compare', name: '单价比价', group: '采购核算', icon: Scale },
  { id: 'interest', name: '借款利息', group: '借贷利息', icon: Percent, fields: [['principal', '本金 / 元'], ['rate', '年利率 / %'], ['days', '计息天数']] },
  { id: 'mortgage', name: '贷款月供', group: '借贷利息', icon: Landmark, fields: [['principal', '贷款本金 / 元'], ['rate', '年利率 / %'], ['months', '还款期数 / 月']] },
  { id: 'lesson', name: '课时费', group: '工资费用', icon: GraduationCap, fields: [['count', '课时数'], ['price', '每课时费用 / 元']] },
];
const SystemCalculator = registerPlugin('SystemCalculator');
const defaults = () => ({ basis: '365', method: 'equalPayment', loanType: 'standard', interestMethod: 'monthly' });
const loanTypes = [['standard', '按揭贷款'], ['bullet', '到期还本'], ['fixed', '固定利率']];
const blankRow = () => ({ name: '', price: '', quantity: '' });

function ToolForm({ tool, onBack }) {
  const [fields, setFields] = useState(defaults);
  const [rows, setRows] = useState(() => [blankRow(), blankRow()]);
  const [result, setResult] = useState(null), [error, setError] = useState(''), [copied, setCopied] = useState('');
  const invalidate = () => { setResult(null); setError(''); setCopied(''); };
  const update = (key, value) => { setFields(previous => ({ ...previous, [key]: value })); invalidate(); };
  const editRow = (index, key, value) => { setRows(previous => previous.map((row, i) => i === index ? { ...row, [key]: value } : row)); invalidate(); };
  const select = (key, label, options) => <label>{label}<select aria-label={label} value={fields[key]} onChange={e => update(key, e.target.value)}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  return <section className="calc-editor" aria-label={tool.name}>
    <header><button type="button" className="icon-button" aria-label="返回工具箱" title="返回工具箱" onClick={onBack}><ArrowLeft size={20} /></button><h2>{tool.name}</h2>
      <button type="button" className="icon-button" aria-label="清空计算" title="清空计算" onClick={() => { setFields(defaults()); setRows([blankRow(), blankRow()]); invalidate(); }}><RotateCcw size={19} /></button></header>
    <form noValidate onSubmit={event => { event.preventDefault(); setCopied(''); try { setResult(calculateTool(tool.id, fields, rows)); setError(''); } catch (err) { setResult(null); setError(err.message); } }}>
      {tool.id === 'mortgage' && <div className="calc-loan-tabs" role="tablist" aria-label="贷款类型">
        {loanTypes.map(([id, label]) => <button type="button" key={id} role="tab" id={`loan-tab-${id}`} aria-selected={fields.loanType === id} aria-controls="loan-fields" onClick={() => update('loanType', id)}>{label}</button>)}
      </div>}
      <div className="calc-fields" {...(tool.id === 'mortgage' ? { id: 'loan-fields', role: 'tabpanel', 'aria-labelledby': `loan-tab-${fields.loanType}` } : {})}>
      {tool.fields?.map(([key, label, placeholder]) => <label key={key}>{label}<input inputMode="decimal" autoComplete="off" value={fields[key] ?? ''} placeholder={placeholder || ''} onChange={e => update(key, e.target.value)} /></label>)}
      {tool.id === 'interest' && select('basis', '年计息基准', [['365', '365 天'], ['360', '360 天']])}
      {tool.id === 'mortgage' && <>
        {fields.loanType === 'bullet' ? <>
          <label>放款日期<DateInput type="date" aria-label="放款日期" value={fields.loanDate || ''} onChange={e => update('loanDate', e.target.value)} /></label>
          {select('interestMethod', '还息方法', [['monthly', '按月还息'], ['maturity', '到期一次还息']])}
        </> : <>
          {fields.loanType === 'fixed' && <>
            <label>首段折扣期限 / 月<input inputMode="numeric" value={fields.discountMonths ?? ''} onChange={e => update('discountMonths', e.target.value)} /></label>
            <label>首段利率折扣 / %<input inputMode="decimal" placeholder="例如 9 折输入 90" value={fields.rateDiscount ?? ''} onChange={e => update('rateDiscount', e.target.value)} /></label>
          </>}
          {select('method', '还款方式', [['equalPayment', '等额本息'], ['equalPrincipal', '等额本金']])}
        </>}
        <p className="calc-note">贷款期限：1–360 个月。{fields.loanType === 'bullet' ? '按整月单利估算，月末放款遇短月时到期日取月末。' : fields.loanType === 'fixed' ? '折扣结束后恢复输入年利率；等额本息按剩余本金和期限重算月供。' : ''}</p>
      </>}
      </div>
      {tool.id === 'salary' && <p className="calc-note">中国大陆居民个人工资估算。按全年 12 个月工资及扣除不变计算月均到手，不代表当月实发；不含奖金、其他综合所得或减免税。社保、公积金填个人实际缴纳且可税前扣除的金额，不含单位部分，空项按 0。专项附加扣除仅抵税，不从工资中扣款。</p>}
      {tool.id === 'compare' && <>
        <p className="calc-note">数量须换算为相同单位，例如全部使用克、毫升或件。</p>
        <div className="calc-items">{rows.map((row, index) => <div className="calc-item" key={index}>
          <label className="calc-item-name">项目 {index + 1}<input aria-label={`项目${index + 1}名称`} value={row.name} maxLength={60} placeholder="名称（选填）" onChange={e => editRow(index, 'name', e.target.value)} /></label>
          <button type="button" className="icon-button" aria-label={`删除项目${index + 1}`} title="删除项目" disabled={rows.length <= 2} onClick={() => { setRows(previous => previous.filter((_, i) => i !== index)); invalidate(); }}><Trash2 size={18} /></button>
          <label>包装价格 / 元<input aria-label={`项目${index + 1}价格`} inputMode="decimal" value={row.price} onChange={e => editRow(index, 'price', e.target.value)} /></label>
          <label>包装内数量<input aria-label={`项目${index + 1}数量`} inputMode="decimal" value={row.quantity} onChange={e => editRow(index, 'quantity', e.target.value)} /></label>
        </div>)}</div>
        <button type="button" className="secondary calc-add" disabled={rows.length >= 50} onClick={() => { setRows(previous => [...previous, blankRow()]); invalidate(); }}><Plus size={17} />添加项目</button>
      </>}
      {['interest', 'mortgage'].includes(tool.id) && <p className="calc-note">按输入的固定利率估算，不含手续费；实际金额以借款合同及机构账单为准。</p>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <button className="primary calc-submit"><Calculator size={18} />计算</button>
    </form>
    {result && <section className="calc-result" aria-label="计算结果" aria-live="polite">
      <div className="calc-result-heading"><span>{result.label}</span><button type="button" className="icon-button" aria-label="复制结果" title="复制结果" onClick={async () => {
        try { await navigator.clipboard.writeText(`${tool.name}${tool.id === 'mortgage' ? ` · ${loanTypes.find(([id]) => id === fields.loanType)[1]}` : ''}\n${result.label}：${result.value} ${result.unit}\n${result.detail}`); setCopied('已复制'); }
        catch { setCopied('复制失败，请选择结果文字复制'); }
      }}><Copy size={18} /></button></div>
      <div className="calc-value"><strong>{tool.id === 'compare' ? String(result.value) : result.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</strong><span>{result.unit}</span></div>
      <details open><summary>计算明细</summary><p>{result.detail}</p></details>
      {copied && <p role="status">{copied}</p>}
    </section>}
  </section>;
}

export function CalculatorTools({ userId, records }) {
  const [active, setActive] = useState(null);
  const [notice, setNotice] = useState('');
  async function openTool(tool) {
    setNotice('');
    if (tool.id !== 'basic') { setActive(tool); return; }
    if (Capacitor.getPlatform() !== 'android') {
      setNotice('请在安卓安装包中使用手机系统计算器');
      return;
    }
    try { await SystemCalculator.open(); }
    catch (error) { setNotice(error.code === 'UNAVAILABLE' || error.code === 'DENIED' ? error.message : '无法打开系统计算器，请确认已安装新版应用及计算器'); }
  }
  const [favorites, setFavorites] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('zaizai-calculator-favorites')); return Array.isArray(saved) ? saved.filter(id => tools.some(tool => tool.id === id)) : ['basic', 'discount', 'split']; }
    catch { return ['basic', 'discount', 'split']; }
  });
  function favorite(id) {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem('zaizai-calculator-favorites', JSON.stringify(next)); } catch { /* Favorites remain available for this session. */ }
  }
  const entries = list => <div className="calc-grid">{list.map(tool => <div className="calc-entry" key={tool.id}>
    <button className="calc-open" onClick={() => openTool(tool)}><tool.icon size={23} /><span>{tool.name}</span></button>
    <button className="calc-star" aria-label={`${favorites.includes(tool.id) ? '取消常用' : '设为常用'}：${tool.name}`} title={favorites.includes(tool.id) ? '取消常用' : '设为常用'} aria-pressed={favorites.includes(tool.id)} onClick={() => favorite(tool.id)}><Star size={15} fill={favorites.includes(tool.id) ? 'currentColor' : 'none'} /></button>
  </div>)}</div>;
  return <div className="calculator-tools">
    {notice && <p className="calc-note" role="status">{notice}</p>}
    {active?.id === 'widgets' ? <DesktopWidgetSettings userId={userId} records={records} onBack={() => setActive(null)} /> : active ? <ToolForm key={active.id} tool={active} onBack={() => setActive(null)} /> : <>
      <button className="secondary widget-entry" onClick={() => { setNotice(''); setActive({ id: 'widgets' }); }}><PanelsTopLeft size={19} />桌面小组件 · 待办与课程</button>
      {favorites.length > 0 && <section><h2>常用工具</h2>{entries(tools.filter(tool => favorites.includes(tool.id)))}</section>}
      {[...new Set(tools.map(tool => tool.group))].map(group => <section key={group}><h2>{group}</h2>{entries(tools.filter(tool => tool.group === group))}</section>)}
    </>}
  </div>;
}
