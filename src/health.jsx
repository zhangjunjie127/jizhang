import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Apple, Camera, Check, ChevronLeft, ChevronRight, Droplets, Dumbbell, Flower2, ImagePlus, LoaderCircle, Pencil, Plus, Scale, Search, Settings2, Trash2, Moon, ClipboardCheck, Smile, Stethoscope, ClipboardPlus } from 'lucide-react';
import { request, syncReminders, isNative } from './api';
import { TaskPhotos } from './task-photos';
import { requestId } from './navigation';
import { DateInput } from './date-picker';
import { prepareImage } from './receipt';
import { FOODS, healthToday, healthSummary, MEALS, nutritionTotal, SYMPTOMS } from '../shared/health.mjs';
import './health.css';

const TITLES = { meal: '记录饮食', water: '记录饮水', exercise: '记录运动', period: '记录生理期', bowel: '记录排便', sleep: '记录睡眠', habit: '健康习惯打卡', checkup: '记录体检', visit: '记录就医', settings: '健康目标', gender: '选择性别' };
const EXTRA_TOOLS = [[Smile, 'bowel', '排便'], [Moon, 'sleep', '睡眠'], [ClipboardCheck, 'habit', '健康习惯'], [ClipboardPlus, 'checkup', '体检'], [Stethoscope, 'visit', '就医']];
const localTime = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
const blankFood = () => ({ name: '', grams: 100, kcal: '', protein: 0, fat: 0, carbs: 0, source: '手动' });
const fmt = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function Tool({ icon: Icon, label, ...props }) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}><Icon size={19} /></button>;
}

export function HealthPage({ user, records, Modal, pending, onProfile, onWeight, onEditWeight, onDeleteWeight, WeightChart, createSignal }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('today');
  const [date, setDate] = useState(healthToday);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [genderNotice, setGenderNotice] = useState('');
  const previousSignal = useRef(createSignal);
  const homeScroll = useRef(0);
  const previousView = useRef('today');
  useLayoutEffect(() => {
    if (previousView.current === view) return;
    if (previousView.current === 'today') homeScroll.current = window.scrollY;
    window.scrollTo({ top: view === 'today' ? homeScroll.current : 0, behavior: 'instant' });
    previousView.current = view;
  }, [view]);
  async function reload() {
    setError('');
    try { setData(await request('/health/dashboard')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    request('/health/dashboard', { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    });
    if (user.gender !== 'female' && view === 'period') setView('today');
    if (user.gender !== 'female') setEditor(current => current?.kind === 'period' ? null : current);
    return () => controller.abort();
  }, [user.id, user.gender]);
  useEffect(() => {
    const controller = new AbortController();
    const sync = () => request('/health/dashboard', { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    });
    window.addEventListener('focus', sync);
    return () => { controller.abort(); window.removeEventListener('focus', sync); };
  }, [user.id, user.gender]);
  useEffect(() => {
    if (createSignal === previousSignal.current) return;
    previousSignal.current = createSignal;
    if (view === 'weight') { onWeight(); return; }
    if (view === 'period') {
      if (user.gender === 'female') setEditor({ kind: 'period', date, flow: 'medium', symptoms: [] });
      else if (!user.gender) setEditor({ kind: 'gender' });
      return;
    }
    if (view === 'water' || EXTRA_TOOLS.some(([, kind]) => kind === view)) {
      setEditor({ kind: view, date });
      return;
    }
    setEditor({ kind: 'menu', kinds: view === 'nutrition' ? ['meal', 'exercise'] : null });
  }, [createSignal, view, date, user.gender, onWeight]);
  const weights = records.filter(r => r.kind === 'weight' && r.status === 'confirmed' && !r.deleted_at)
    .sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.created.localeCompare(a.created));
  const entries = data?.entries || [];
  const selected = entries.filter(r => r.date === date);
  const totals = healthSummary(entries, date);
  const settings = data?.settings || {};
  const goal = user.adult ? settings.calorieGoal || 0 : 0;
  const remaining = goal ? goal - totals.kcal : null;
  const bmi = user.adult && weights.length && settings.heightCm ? weights[0].payload.kg / (settings.heightCm / 100) ** 2 : null;
  const periods = entries.filter(r => r.kind === 'period').sort((a, b) => b.date.localeCompare(a.date));
  const ongoing = periods.find(r => !r.end);
  function periodView() {
    if (!user.gender) setEditor({ kind: 'gender' });
    else if (user.gender === 'female') setView('period');
  }
  function open(kind, extra = {}) {
    if (kind === 'period') { periodView(); return; }
    if (kind === 'weight') { onWeight(); return; }
    setEditor({ kind, date, ...extra });
  }
  function shiftDate(delta) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + delta);
    setDate(day.toISOString().slice(0, 10));
  }
  function row(entry) {
    const medical = ['checkup', 'visit'].includes(entry.kind);
    const total = entry.kind === 'meal' ? nutritionTotal(entry.items) : null;
    const label = medical ? `${entry.kind === 'checkup' ? '体检' : '就医'} · ${entry.institution}` : entry.kind === 'meal' ? `${MEALS[entry.meal]} · ${entry.items.map(i => i.name).join('、')}`
      : entry.kind === 'water' ? '饮水' : ['exercise', 'habit'].includes(entry.kind) ? entry.name : entry.kind === 'bowel' ? `排便 · ${entry.texture}` : entry.kind === 'sleep' ? `睡眠 · ${entry.quality}` : '生理期';
    return <div className="health-record" key={entry.id}>
      <div><strong>{label}</strong><small>{entry.date}{entry.kind === 'exercise' ? ` · ${fmt(entry.minutes)} 分钟` : ''}
        {entry.kind === 'period' ? ` 至 ${entry.end || '进行中'} · ${{ light: '量少', medium: '量中', heavy: '量多' }[entry.flow]}` : ''}</small>
        {medical && <small>{entry.kind === 'checkup' ? entry.items : [entry.department, entry.reason].filter(Boolean).join(' · ')}</small>}
        {entry.followUp && <small>复诊：{new Date(entry.followUp).toLocaleString('zh-CN', { hour12: false })}</small>}</div>
      <span>{medical ? `${entry.photos.length} 张照片` : entry.kind === 'water' ? `${fmt(entry.ml)} ml` : entry.kind === 'sleep' ? `${fmt((Date.parse(entry.end) - Date.parse(entry.start)) / 3600000)} 小时` : entry.kind === 'habit' ? '已打卡' : ['period', 'bowel'].includes(entry.kind) ? '' : `${fmt(total?.kcal ?? entry.kcal)} 千卡`}</span>
      <Tool icon={Pencil} label={`编辑${entry.kind === 'meal' ? '饮食' : label}`} onClick={() => setEditor(entry)} />
      <Tool icon={Trash2} label={`删除${entry.kind === 'meal' ? '饮食' : label}`} onClick={() => setDeleteEntry(entry)} />
    </div>;
  }
  return <main className={`health-dashboard${view === 'today' ? ' health-home' : ''}`}>
    <div className="health-fixed-header">
    <header className="health-top-search" aria-label="健康"><button disabled={!data} onClick={() => open('meal')}><Search size={19} /><span>搜索食物营养和热量</span></button><Tool icon={Camera} label="拍照记录" disabled={!data} onClick={() => open('meal', { mode: 'photo' })} /><Tool icon={Settings2} label="健康目标设置" disabled={!data} onClick={() => setEditor({ kind: 'settings', ...settings })} /></header>
    {view !== 'today' && <div className="health-subpage-heading"><Tool icon={ChevronLeft} label="返回健康首页" onClick={() => setView('today')} /><h1>{{ history: '健康记录', weight: '体重趋势', period: '生理期', nutrition: '饮食与运动', water: '喝水记录', bowel: '排便记录', sleep: '睡眠记录', habit: '健康习惯', checkup: '体检记录', visit: '就医记录' }[view]}</h1></div>}
    </div>
    {pending}
    {genderNotice && <p className="health-status" role="status">{genderNotice}</p>}
    {error && <div className="health-error" role="alert">{error}<button className="secondary" onClick={reload}>重试</button></div>}
    {!data && !error && <p className="health-loading" role="status"><LoaderCircle className="spin" size={20} />正在加载健康记录</p>}
    {data && <>
      {['today', 'history', 'nutrition', 'water'].includes(view) && <div className="health-day">
        <Tool icon={ChevronLeft} label="前一天" onClick={() => shiftDate(-1)} />
        <label><DateInput aria-label="健康记录日期" value={date} max={healthToday()} onChange={e => setDate(e.target.value || healthToday())} /></label>
        <Tool icon={ChevronRight} label="后一天" disabled={date >= healthToday()} onClick={() => shiftDate(1)} />
      </div>}
      {view === 'today' && <>
        <section className="health-weight-band">
          <div className="health-section-heading"><h2>体重管理</h2><button className="health-text-button" onClick={() => setView('weight')}>体重趋势<ChevronRight size={16} /></button></div>
          <progress aria-label="体重目标进度" max="100" value={weights.length && settings.goalKg && weights.at(-1).payload.kg !== settings.goalKg ? Math.max(0, Math.min(100, (weights.at(-1).payload.kg - weights[0].payload.kg) / (weights.at(-1).payload.kg - settings.goalKg) * 100)) : 0} />
          <div className="health-band-values">{[['初始', weights.at(-1)?.payload.kg], ['当前', weights[0]?.payload.kg], ['目标', user.adult ? settings.goalKg : null]].map(([label, value]) => <div key={label}><strong>{value ? fmt(value) : '—'}</strong><small>{label} · kg</small></div>)}</div>
        </section>
        <div className="health-section-heading"><h2 className="health-record-title">健康记录</h2><Tool icon={ChevronRight} label="查看健康记录" onClick={() => setView('history')} /></div>
        <section className="health-food-overview">
          <div className="health-section-heading"><h2>饮食＆运动记录</h2><Tool icon={Dumbbell} label="添加运动" onClick={() => open('exercise')} /><Tool icon={ChevronRight} label="饮食运动详情" onClick={() => setView('nutrition')} /></div>
          <div className="health-food-summary"><div><small>{remaining === null ? '已摄入' : remaining >= 0 ? '距自设目标' : '高于自设目标'}</small><strong>{fmt(remaining === null ? totals.kcal : Math.abs(remaining))}</strong><small>千卡</small></div>
            <div className="health-meal-markers">{Object.entries(MEALS).map(([meal, label]) => <button key={meal} aria-label={`添加${label}`} onClick={() => open('meal', { meal })}><span className={selected.some(r => r.kind === 'meal' && r.meal === meal) ? 'recorded' : ''} />{label.slice(0, 1)}</button>)}</div></div>
        </section>
        <div className="health-tile-grid">
          <button className="health-tile weight" onClick={() => setView('weight')}><strong>体重</strong><small>{weights[0]?.payload.date || '暂无记录'}</small><p>{weights.length ? fmt(weights[0].payload.kg) : '—'}<small> kg</small></p><Scale className="health-tile-art" /></button>
          <button className="health-tile water" aria-label="打开喝水记录" onClick={() => setView('water')}><strong>喝水记录</strong><small>{date}</small><p>{fmt(totals.water)}<small> ml</small></p><Droplets className="health-tile-art" /></button>
          {user.gender !== 'male' && <button className="health-tile period" aria-label="打开生理期" onClick={periodView}><strong>生理期</strong><small>{!user.gender ? '待完善性别' : ongoing ? '经期进行中' : '经期记录'}</small><p className="health-tile-caption">{periods[0]?.date || '暂无记录'}</p><Flower2 className="health-tile-art" /></button>}
          {EXTRA_TOOLS.map(([Icon, kind, label]) => {
            const list = selected.filter(r => r.kind === kind);
            const value = kind === 'sleep' ? `${fmt(list.reduce((sum, r) => sum + (Date.parse(r.end) - Date.parse(r.start)) / 3600000, 0))} 小时` : `${list.length} ${kind === 'habit' ? '项完成' : '次'}`;
            return <button key={kind} className={`health-tile ${kind}`} onClick={() => setView(kind)}><strong>{label}</strong><small>{date}</small><p className="health-tile-caption">{list.length ? value : '暂无记录'}</p><Icon className="health-tile-art" /></button>;
          })}
        </div>
      </>}
      {view === 'nutrition' && <>
        <section className="health-energy" aria-label="今日热量">
          <div className="health-energy-side"><span>{user.adult ? '自设饮食目标' : '已记录餐次'}</span><strong>{user.adult ? goal ? fmt(goal) : '未设置' : selected.filter(r => r.kind === 'meal').length}</strong><small>{user.adult ? '千卡' : '次'}</small></div>
          <div className="health-ring" style={{ '--progress': `${goal ? Math.min(100, totals.kcal / goal * 100) : 0}%` }}><div><span>已摄入</span><strong>{fmt(totals.kcal)}</strong><small>千卡</small></div></div>
          <div className="health-energy-side"><span>运动记录</span><strong>{fmt(totals.exercise)}</strong><small>千卡</small></div>
          {remaining !== null && <p className="health-energy-note">{remaining >= 0 ? `距自设目标 ${fmt(remaining)} 千卡` : `高于自设目标 ${fmt(-remaining)} 千卡`}</p>}
        </section>
        <div className="health-macros">{[['protein', '蛋白质'], ['fat', '脂肪'], ['carbs', '碳水化合物']].map(([key, title]) =>
          <div key={key} className={key}><span>{title}</span><strong>{fmt(totals[key])}<small> g</small></strong></div>)}</div>
        <div className="health-shortcuts">
          {[[Apple, 'meal', '饮食'], [Droplets, 'water', '饮水'], [Dumbbell, 'exercise', '运动'], [Scale, 'weight', '体重'],
            ...(user.gender !== 'male' ? [[Flower2, 'period', '生理期']] : [])].map(([Icon, kind, label]) =>
            <button key={kind} onClick={() => open(kind, kind === 'meal' ? { meal: 'breakfast' } : {})}><span className={`health-tool-${kind}`}><Icon size={22} /></span>{label}</button>)}
        </div>
        <section className="health-section">
          <div className="health-section-heading"><h2>饮食记录</h2></div>
          {Object.entries(MEALS).map(([meal, label]) => {
            const list = selected.filter(r => r.kind === 'meal' && r.meal === meal);
            return <div className="health-meal" key={meal}><div className="health-meal-heading"><strong>{label}</strong><small>{list.length ? `${fmt(nutritionTotal(list.flatMap(r => r.items)).kcal)} 千卡` : '暂无记录'}</small><Tool icon={Plus} label={`添加${label}`} onClick={() => open('meal', { meal })} /></div>{list.map(row)}</div>;
          })}
        </section>
        <section className="health-section health-water"><div className="health-section-heading"><h2>饮水</h2><span><strong>{fmt(totals.water)}</strong> ml{settings.waterGoal > 0 ? ` / 自设 ${fmt(settings.waterGoal)} ml` : ''}</span><Tool icon={Plus} label="添加饮水" onClick={() => open('water')} /></div>
          {settings.waterGoal > 0 && <progress max={settings.waterGoal} value={totals.water} aria-label="自设饮水目标完成量" />}
          <div className="health-water-actions">{[150, 250, 500].map(ml => <button className="secondary" key={ml} onClick={() => open('water', { ml })}><Droplets size={16} />{ml} ml</button>)}</div>
        </section>
        <section className="health-section"><div className="health-section-heading"><h2>运动</h2><span>{fmt(totals.minutes)} 分钟</span><Tool icon={Plus} label="添加运动" onClick={() => open('exercise')} /></div>{selected.filter(r => r.kind === 'exercise').map(row)}{!totals.minutes && <p className="health-empty">今天还没有运动记录</p>}</section>
        <section className="health-section"><div className="health-section-heading"><h2>体重</h2><button className="health-text-button" onClick={() => setView('weight')}>查看趋势<ChevronRight size={16} /></button></div>
          <div className="health-weight-summary"><strong>{weights.length ? fmt(weights[0].payload.kg) : '—'}<small> kg</small></strong><span>{weights[0]?.payload.date || '暂无记录'}</span><Tool icon={Plus} label="记录体重" onClick={onWeight} /></div></section>
        {user.gender !== 'male' && <section className="health-section health-cycle-entry"><Flower2 size={23} /><div><h2>生理期</h2><span>{!user.gender ? '待完善性别' : ongoing ? `${ongoing.date} 开始 · 进行中` : periods.length ? `上次开始 ${periods[0].date}` : '暂无记录'}</span></div><Tool icon={ChevronRight} label="打开生理期" onClick={periodView} /></section>}
      </>}
      {view === 'water' && <section className="health-section health-water"><div className="health-section-heading"><h2>饮水</h2><span>{fmt(totals.water)} ml</span><Tool icon={Plus} label="添加饮水" onClick={() => open('water')} /></div>
        {settings.waterGoal > 0 && <progress max={settings.waterGoal} value={totals.water} aria-label="自设饮水目标完成量" />}
        <div className="health-water-actions">{[150, 250, 500].map(ml => <button className="secondary" key={ml} onClick={() => open('water', { ml })}><Droplets size={16} />{ml} ml</button>)}</div>
        {selected.filter(r => r.kind === 'water').map(row)}
        {!totals.water && <p className="health-empty">当天暂无饮水记录</p>}
      </section>}
      {EXTRA_TOOLS.some(([, kind]) => kind === view) && <section className="health-section">
        <div className="health-section-heading"><h2>{EXTRA_TOOLS.find(([, kind]) => kind === view)[2]}</h2><Tool icon={Plus} label={TITLES[view]} onClick={() => open(view)} /></div>
        {entries.filter(r => r.kind === view).map(row)}
        {!entries.some(r => r.kind === view) && <p className="health-empty">暂无记录</p>}
      </section>}
      {view === 'history' && <section className="health-section"><h2>当天记录</h2>{selected.filter(r => r.kind !== 'period').map(row)}{!selected.some(r => r.kind !== 'period') && <p className="health-empty">当天暂无健康记录</p>}</section>}
      {view === 'weight' && <section className="health-section">
        <div className="health-section-heading"><h2>体重趋势</h2><Tool icon={Plus} label="记录体重" onClick={onWeight} /></div>
        <div className="health-weight-stats"><div><span>最新体重</span><strong>{weights.length ? fmt(weights[0].payload.kg) : '—'}<small> kg</small></strong></div><div><span>{user.adult ? '自设目标' : '累计记录'}</span><strong>{user.adult ? settings.goalKg ? `${fmt(settings.goalKg)} kg` : '未设置' : `${weights.length} 次`}</strong></div>
          <div><span>{user.adult ? 'BMI' : '与上次相比'}</span><strong>{user.adult ? bmi ? bmi.toFixed(1) : '—' : weights.length > 1 ? `${(weights[0].payload.kg - weights[1].payload.kg).toFixed(1)} kg` : '—'}</strong></div></div>
        {weights.length >= 2 && <WeightChart records={weights} />}
        {user.adult && <p className="health-caution">BMI 仅供成人参考，不能代替健康评估。</p>}
        {weights.map(r => <div className="health-record" key={r.id}><div><strong>{r.payload.date}</strong><small>体重记录</small></div><span>{fmt(r.payload.kg)} kg</span><Tool icon={Pencil} label="编辑体重" onClick={() => onEditWeight(r)} /><Tool icon={Trash2} label="删除体重" onClick={() => onDeleteWeight(r)} /></div>)}
        {!weights.length && <p className="health-empty">暂无体重记录</p>}
      </section>}
      {view === 'period' && user.gender === 'female' && <section className="health-section">
        <div className="health-section-heading"><h2>生理期记录</h2><Tool icon={Plus} label="新增生理期" onClick={() => setEditor({ kind: 'period', date, flow: 'medium', symptoms: [] })} /></div>
        {ongoing && <div className="health-ongoing"><Flower2 size={22} /><div><strong>经期进行中</strong><span>{ongoing.date} 开始</span></div><button className="secondary" onClick={() => setEditor({ ...ongoing, end: healthToday() })}>记录结束</button></div>}
        {periods.map(row)}{!periods.length && <p className="health-empty">暂无生理期记录</p>}
        <p className="health-caution">仅记录已发生的经期，不用于避孕或疾病诊断。</p>
      </section>}
    </>}
    {editor?.kind === 'menu' && <Modal title="添加健康记录" onClose={() => setEditor(null)}><div className="health-add-menu">
      {[[Apple, 'meal', '饮食'], [Droplets, 'water', '饮水'], [Dumbbell, 'exercise', '运动'], [Scale, 'weight', '体重'], ...(user.gender !== 'male' ? [[Flower2, 'period', '生理期']] : []), ...EXTRA_TOOLS].filter(([, kind]) => !editor.kinds || editor.kinds.includes(kind)).map(([Icon, kind, label]) =>
        <button key={kind} onClick={() => { setEditor(null); open(kind, kind === 'meal' ? { meal: 'breakfast' } : {}); }}><Icon size={20} />{label}<ChevronRight size={17} /></button>)}</div></Modal>}
    {editor && editor.kind !== 'menu' && <HealthEditor key={editor.id || editor.kind} entry={editor} user={user} Modal={Modal} recent={entries.filter(r => r.kind === 'meal').flatMap(r => r.items)}
      onClose={() => setEditor(null)} onSaved={(result, askReminder) => { setData(result); setEditor(null); if (isNative) syncReminders(records, Boolean(askReminder)).catch(e => setError(e.message)); }}
      onGender={async gender => {
        await onProfile(gender);
        setData(await request('/health/dashboard'));
        setEditor(null);
        setView(gender === 'female' ? 'period' : 'today');
        setGenderNotice(gender === 'female' ? '' : '性别已保存，生理期入口已隐藏');
      }} />}
    {deleteEntry && <Modal title="删除健康记录" onClose={() => !deleting && setDeleteEntry(null)}><p>确定删除这条记录？删除后不能恢复。</p><div className="modal-actions"><button className="secondary" disabled={deleting} onClick={() => setDeleteEntry(null)}>取消</button><button className="danger" disabled={deleting} onClick={async () => {
      setDeleting(true);
      try { setData(await request(`/health/entries/${deleteEntry.id}`, { method: 'DELETE', body: { revision: deleteEntry.revision } })); setDeleteEntry(null); if (isNative) syncReminders(records).catch(e => setError(e.message)); }
      catch (e) { setError(e.message); setDeleteEntry(null); }
      finally { setDeleting(false); }
    }}>{deleting ? '删除中' : '确认删除'}</button></div></Modal>}
  </main>;
}

function HealthEditor({ entry, user, Modal, recent, onClose, onSaved, onGender }) {
  const [draft, setDraft] = useState(() => ({ date: healthToday(), meal: 'breakfast', ml: 250, minutes: 30, kcal: 0, symptoms: [], flow: 'medium', texture: '成形', quality: '一般',
    ...(entry.kind === 'sleep' ? { start: localTime(Date.now() - 8 * 3600000), end: localTime(Date.now()) } : {}), ...entry,
    items: entry.kind === 'checkup' ? entry.items || '' : entry.items?.map(item => ({ ...item })) || [] }));
  const [mode, setMode] = useState(entry.mode || (entry.kind === 'meal' && entry.items?.length ? 'manual' : 'search'));
  const medical = ['checkup', 'visit'].includes(entry.kind);
  const [step, setStep] = useState(0);
  const [foodIndex, setFoodIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState(null);
  const id = useRef(requestId());
  const camera = useRef(null), album = useRef(null);
  const active = useRef(true), controller = useRef(null);
  const saving = useRef(false);
  const form = useRef(null);
  useLayoutEffect(() => {
    const modal = form.current?.closest('.modal');
    if (modal) modal.scrollTop = 0;
  }, [step, mode, foodIndex]);
  useEffect(() => () => { active.current = false; controller.current?.abort(); }, []);
  const update = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const changeItem = (index, key, value) => setDraft(d => ({ ...d, items: d.items.map((item, i) => {
    if (i !== index) return item;
    if (key === 'grams' && Number(value) > 0 && Number(item.grams) > 0) {
      const factor = Number(value) / Number(item.grams);
      return { ...item, grams: value, ...Object.fromEntries(['kcal', 'protein', 'fat', 'carbs'].map(k => [k, item[k] === '' ? '' : Math.round(Number(item[k]) * factor * 10) / 10])) };
    }
    return { ...item, [key]: value };
  }) }));
  async function recognize() {
    if (!photo || !consent) return;
    setBusy(true); setError(''); controller.current = new AbortController();
    try {
      const result = await request('/health/recognize', { method: 'POST', body: { image: photo, consent }, signal: controller.current.signal });
      if (active.current) { update('items', result.items); setFoodIndex(0); setWarnings(result.warnings); setMode('manual'); }
    } catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(false); }
  }
  async function choose(file) {
    if (!file) return;
    setError(''); setBusy(true);
    try { const image = await prepareImage(file); if (active.current) setPhoto(image); }
    catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || photosBusy) return;
    if (medical && step < 2) { setStep(value => value + 1); return; }
    if (entry.kind === 'meal') {
      const invalid = draft.items.findIndex(item => !item.name.trim() || item.name.length > 80 ||
        [['grams', .1, 10000], ['kcal', 0, 20000], ['protein', 0, 2000], ['fat', 0, 2000], ['carbs', 0, 2000]].some(([key, min, max]) =>
          item[key] === '' || !Number.isFinite(Number(item[key])) || Number(item[key]) < min || Number(item[key]) > max));
      if (invalid >= 0) { setMode('manual'); setFoodIndex(invalid); setError(`请完善食物 ${invalid + 1} 的名称和营养数值`); return; }
    }
    saving.current = true;
    setBusy(true); setError('');
    try {
      if (entry.kind === 'gender') await onGender(draft.gender);
      else if (entry.kind === 'settings') onSaved(await request('/health/settings', { method: 'PUT', body: {
        heightCm: draft.heightCm || 0, goalKg: user.adult ? draft.goalKg || 0 : 0,
        calorieGoal: user.adult ? draft.calorieGoal || 0 : 0, waterGoal: draft.waterGoal || 0,
      } }));
      else {
        const body = { ...draft, requestId: id.current };
        if (['checkup', 'visit'].includes(entry.kind)) {
          body.photos = [];
          for (const photo of draft.photos || []) body.photos.push(photo.startsWith('data:')
            ? (await request('/task-photos', { method: 'POST', body: { image: photo } })).id : photo);
          if (entry.kind === 'visit') body.followUp = draft.followUp ? new Date(draft.followUp).toISOString() : '';
        }
        if (entry.kind === 'sleep') { body.start = new Date(draft.start).toISOString(); body.end = new Date(draft.end).toISOString(); }
        onSaved(await request(entry.id ? `/health/entries/${entry.id}` : '/health/entries', {
          method: entry.id ? 'PATCH' : 'POST', body,
        }), entry.kind === 'visit' && Date.parse(body.followUp) > Date.now());
      }
    } catch (e) { saving.current = false; setError(e.message); setBusy(false); }
  }
  const foods = [...FOODS, ...recent.filter((food, index, list) => list.findIndex(i => i.name === food.name) === index && !FOODS.some(f => f.name === food.name))].filter(f => f.name.includes(query.trim()));
  const close = () => { if (!saving.current) onClose(); };
  return <Modal className="health-editor" title={entry.id ? `修改${TITLES[entry.kind].replace('记录', '')}` : TITLES[entry.kind]} onClose={close}>
    <form ref={form} onSubmit={submit}>
      {medical && <div className="health-step-heading" role="status"><strong>{['基本信息', entry.kind === 'checkup' ? '体检备注' : '医嘱与复诊', '报告照片'][step]}</strong><span>{step + 1} / 3</span></div>}
      <fieldset disabled={busy} className={`health-fields${entry.kind === 'meal' ? ' health-meal-fields' : ''}`}>
        {!['settings', 'gender'].includes(entry.kind) && (!medical || step === 0) && <label>{entry.kind === 'period' ? '开始日期' : '日期'}<DateInput value={draft.date} max={healthToday()} onChange={e => update('date', e.target.value)} required /></label>}
        {entry.kind === 'gender' && <><p>请选择并保存性别后使用生理期记录。</p><label>性别<select aria-label="性别" required value={draft.gender || ''} onChange={e => update('gender', e.target.value)}><option value="">请选择</option><option value="female">女</option><option value="male">男</option></select></label></>}
        {entry.kind === 'settings' && <>
          <label>身高（cm）<input type="number" min="50" max="250" step=".1" value={draft.heightCm || ''} onChange={e => update('heightCm', e.target.value)} /></label>
          {user.adult && <><label>自设目标体重（kg，可不填）<input type="number" min="10" max="500" step=".1" value={draft.goalKg || ''} onChange={e => update('goalKg', e.target.value)} /></label>
            <label>自设每日饮食热量（千卡，可不填）<input type="number" min="1" max="10000" step=".1" value={draft.calorieGoal || ''} onChange={e => update('calorieGoal', e.target.value)} /></label></>}
          <label>自设每日饮水量（ml，可不填）<input type="number" min="1" max="10000" step=".1" value={draft.waterGoal || ''} onChange={e => update('waterGoal', e.target.value)} /></label>
          <p className="health-caution">目标由你自行设置，不是医疗或营养建议。</p>
        </>}
        {entry.kind === 'meal' && <>
          <label>餐次<select aria-label="餐次" value={draft.meal} onChange={e => update('meal', e.target.value)}>{Object.entries(MEALS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
          <div className="health-tabs health-editor-tabs">{[['search', '搜索食物'], ['manual', '手动填写'], ['photo', '拍照识别']].map(([id, name]) =>
            <button type="button" key={id} aria-pressed={mode === id} className={mode === id ? 'active' : ''} onClick={() => { setMode(id); if (id === 'manual' && !draft.items.length) update('items', [blankFood()]); }}>{name}</button>)}</div>
          {mode === 'search' && <><label className="health-search"><Search size={18} /><input aria-label="搜索食物" placeholder="搜索食物名称" value={query} onChange={e => setQuery(e.target.value)} /></label>
            <small className="health-source">基础食物库 · USDA / 历史记录 · 营养参考值</small>
            <div className="health-food-search">{foods.slice(0, 30).map(food => <button type="button" key={food.name} disabled={draft.items.length >= 30} onClick={() => { setFoodIndex(draft.items.length); update('items', [...draft.items, { ...food }]); setMode('manual'); }}><span><strong>{food.name}</strong><small>{food.grams} g · {fmt(food.kcal)} 千卡 · {food.source}</small></span><Plus size={18} /></button>)}
              {!foods.length && <p className="health-empty">暂无匹配食物，可切换手动填写。</p>}</div></>}
          {mode === 'photo' && <div className="health-photo">
            <input ref={camera} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={album} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} />
            {photo && <img src={photo} alt="待识别食物" />}
            <div className="health-photo-buttons"><button type="button" className="secondary" onClick={() => camera.current.click()}><Camera size={18} />拍照</button><button type="button" className="secondary" onClick={() => album.current.click()}><ImagePlus size={18} />相册</button></div>
            <label className="health-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />同意将照片发送至已配置的 AI 服务。应用不保存原图，上游服务适用其数据政策。</label>
            <button type="button" className="primary" disabled={!consent || !photo || busy} onClick={recognize}>识别食物</button>
          </div>}
          {warnings.length > 0 && <div className="health-caution" role="status">{warnings.map((text, i) => <p key={i}>{text}</p>)}</div>}
          {mode === 'manual' && <div className="health-food-items">
          {draft.items.length > 1 && <div className="health-food-pager"><Tool icon={ChevronLeft} label="上一项食物" disabled={foodIndex === 0} onClick={() => setFoodIndex(i => i - 1)} /><span>{foodIndex + 1} / {draft.items.length}</span><Tool icon={ChevronRight} label="下一项食物" disabled={foodIndex >= draft.items.length - 1} onClick={() => setFoodIndex(i => i + 1)} /></div>}
          {draft.items.map((item, i) => i === foodIndex && <section className="health-food-item" key={i}>
            <div className="health-food-item-heading"><strong>食物 {i + 1}</strong><small>{item.source === 'AI' ? 'AI 估算' : item.source}</small><Tool icon={Trash2} label={`移除食物${i + 1}`} onClick={() => { update('items', draft.items.filter((_, index) => index !== i)); setFoodIndex(Math.max(0, i - 1)); }} /></div>
            <label>食物名称<input required maxLength="80" value={item.name} onChange={e => changeItem(i, 'name', e.target.value)} /></label>
            <div className="health-form-grid">{[['grams', '重量（g）', .1, 10000], ['kcal', '该份热量（千卡）', 0, 20000], ['protein', '蛋白质（g）', 0, 2000], ['fat', '脂肪（g）', 0, 2000], ['carbs', '碳水（g）', 0, 2000]].map(([key, title, min, max]) =>
              <label key={key}>{title}<input required type="number" inputMode="decimal" min={min} max={max} step=".1" value={item[key]} onChange={e => changeItem(i, key, e.target.value)} /></label>)}</div>
          </section>)}</div>}
          <button type="button" className="secondary" disabled={draft.items.length >= 30} onClick={() => { setFoodIndex(draft.items.length); update('items', [...draft.items, blankFood()]); setMode('manual'); }}><Plus size={16} />添加食物</button>
          <div className="health-meal-total"><span>合计</span><strong>{fmt(nutritionTotal(draft.items).kcal)} 千卡</strong></div>
        </>}
        {entry.kind === 'water' && <label>饮水量（ml）<input required type="number" min="1" max="5000" step=".1" value={draft.ml} onChange={e => update('ml', e.target.value)} /></label>}
        {entry.kind === 'bowel' && <><label>排便形态<select aria-label="排便形态" value={draft.texture} onChange={e => update('texture', e.target.value)}>{['偏硬', '成形', '偏稀'].map(v => <option key={v}>{v}</option>)}</select></label><label>备注<textarea maxLength="300" value={draft.note || ''} onChange={e => update('note', e.target.value)} /></label></>}
        {entry.kind === 'sleep' && <>{[['start', '入睡时间'], ['end', '醒来时间']].map(([key, label]) => <label key={key}>{label}<input required type="datetime-local" max={localTime(Date.now())} value={localTime(draft[key])} onChange={e => update(key, e.target.value)} /></label>)}<label>睡眠感受<select aria-label="睡眠感受" value={draft.quality} onChange={e => update('quality', e.target.value)}>{['较好', '一般', '较差'].map(v => <option key={v}>{v}</option>)}</select></label></>}
        {entry.kind === 'habit' && <label>习惯名称<input required maxLength="40" placeholder="例如：拉伸、按时休息" value={draft.name || ''} onChange={e => update('name', e.target.value)} /></label>}
        {medical && step === 0 && <>
          <label>{entry.kind === 'checkup' ? '体检机构' : '医院'}<input required maxLength="100" value={draft.institution || ''} onChange={e => update('institution', e.target.value)} /></label>
          {entry.kind === 'checkup' ?
            <label>检查项目<textarea required maxLength="500" rows="2" value={typeof draft.items === 'string' ? draft.items : ''} onChange={e => update('items', e.target.value)} /></label>
          : <>
            <label>科室<input maxLength="80" value={draft.department || ''} onChange={e => update('department', e.target.value)} /></label>
            <label>就诊原因<textarea required maxLength="500" rows="2" value={draft.reason || ''} onChange={e => update('reason', e.target.value)} /></label>
          </>}
        </>}
        {medical && step === 1 && (entry.kind === 'checkup' ?
            <label>备注<textarea maxLength="2000" rows="4" value={draft.note || ''} onChange={e => update('note', e.target.value)} /></label>
          : <>
            <label>医嘱<textarea maxLength="2000" rows="3" value={draft.advice || ''} onChange={e => update('advice', e.target.value)} /></label>
            <label>复诊提醒时间（可不填）<input type="datetime-local" value={draft.followUp ? localTime(draft.followUp) : ''} onChange={e => update('followUp', e.target.value)} /></label>
            {!isNative && <p className="health-caution">网页版仅在应用打开时提醒；手机系统提醒需要通知权限。</p>}
          </>)}
        {medical && step === 2 &&
          <TaskPhotos title="报告照片" photos={draft.photos || []} onChange={photos => update('photos', photos)} disabled={busy} onBusyChange={setPhotosBusy} />
        }
        {entry.kind === 'exercise' && <><label>运动名称<input required maxLength="80" placeholder="例如：散步、跑步" value={draft.name || ''} onChange={e => update('name', e.target.value)} /></label>
          <label>时长（分钟）<input required type="number" min="1" max="1440" step=".1" value={draft.minutes} onChange={e => update('minutes', e.target.value)} /></label>
          <label>设备或自填消耗（千卡，未知填 0）<input required type="number" min="0" max="20000" step=".1" value={draft.kcal} onChange={e => update('kcal', e.target.value)} /></label></>}
        {entry.kind === 'period' && <>
          <label>结束日期（进行中可留空）<DateInput value={draft.end || ''} min={draft.date} max={healthToday()} onChange={e => update('end', e.target.value)} /></label>
          <label>经量<select aria-label="经量" value={draft.flow} onChange={e => update('flow', e.target.value)}><option value="light">少</option><option value="medium">中</option><option value="heavy">多</option></select></label>
          <div className="health-symptoms"><span>身体感受</span>{SYMPTOMS.map(symptom => <label key={symptom}><input type="checkbox" checked={draft.symptoms.includes(symptom)} onChange={e => update('symptoms', e.target.checked ? [...draft.symptoms, symptom] : draft.symptoms.filter(s => s !== symptom))} />{symptom}</label>)}</div>
          <label>备注<textarea maxLength="300" rows="2" value={draft.note || ''} onChange={e => update('note', e.target.value)} /></label>
        </>}
      </fieldset>
      {error && <p className="health-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={saving.current} onClick={close}>{busy ? '取消并返回' : '取消'}</button>
        {medical && step > 0 && <button type="button" className="secondary" disabled={busy || photosBusy} onClick={() => setStep(value => value - 1)}><ChevronLeft size={16} />上一步</button>}
        <button type="submit" className="primary" disabled={busy || photosBusy || (entry.kind === 'meal' && !draft.items.length)}>{busy ? <LoaderCircle size={17} className="spin" /> : medical && step < 2 ? <ChevronRight size={17} /> : <Check size={17} />}{busy ? '处理中' : medical && step < 2 ? '下一步' : entry.kind === 'meal' ? '确认保存' : '保存'}</button></div>
    </form>
  </Modal>;
}
