import { DateInput } from './date-picker';
import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, Check, Pencil, Trash2, Plus, ReceiptText } from 'lucide-react';
import { request } from './api';
import { requestId } from './navigation';
import { receiptCents, validateReceipt } from '../shared/receipt.mjs';
import { EXPENSE_CATEGORIES as CATEGORIES, CategoryIcon } from './categories';

async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('原图超过 20MB，请裁剪后上传');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL('image/jpeg', .9);
    if (image.length > 5.3 * 1024 * 1024) image = canvas.toDataURL('image/jpeg', .72);
    if (image.length > 5.3 * 1024 * 1024) throw new Error('图片仍然太大，请裁剪后重试');
    return image;
  } finally { bitmap.close(); }
}
const amountLabel = value => value === '' || value == null || !Number.isFinite(Number(value)) ? '待核对' : `¥ ${Number(value).toFixed(2)}`;
const withKeys = payload => ({ ...payload, receipt: { ...payload.receipt, items: payload.receipt.items.map(item => ({ ...item, _key: requestId() })) } });

export function ReceiptModal({ Modal, initial, onSave, onClose }) {
  const [payload, setPayload] = useState(() => initial ? withKeys(initial.payload) : null);
  const [editing, setEditing] = useState(!initial || initial.status !== 'confirmed');
  const [preview, setPreview] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState(null);
  const [checked, setChecked] = useState(false);
  const camera = useRef(null), album = useRef(null), controller = useRef(null);
  const saveId = useRef(requestId());
  useEffect(() => () => controller.current?.abort(), []);
  const change = (key, value) => { setChecked(false); setPayload(p => ({ ...p, [key]: value })); };
  const changeReceipt = (key, value) => { setChecked(false); setPayload(p => ({ ...p, receipt: { ...p.receipt, [key]: value } })); };
  const changeItem = (key, changes) => changeReceipt('items', payload.receipt.items.map(item => item._key === key ? { ...item, ...changes } : item));
  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setChecked(false);
    try {
      const image = await prepareImage(file);
      setPreview(image); setPayload(null); setWarnings([]); setOpenItem(null);
      controller.current = new AbortController();
      const result = await request('/receipts/recognize', { method: 'POST', body: { image }, signal: controller.current.signal });
      setPayload(withKeys(result.payload)); setWarnings(result.warnings); setOpenItem(null);
    } catch (error) { if (error.name !== 'AbortError') setError(error.message); }
    finally { setBusy(false); }
  }
  let validation = '';
  if (payload) {
    try {
      if (!payload.date) throw new Error('请核对购买日期');
      const total = receiptCents(payload.amount);
      if (total <= 0) throw new Error('实付金额需大于零');
      validateReceipt(payload.receipt, total);
    } catch (error) { validation = error.message; }
  }
  async function save(event) {
    event.preventDefault();
    if (validation || !checked) return;
    setBusy(true); setError('');
    try {
      await onSave('expense', { ...payload, receipt: validateReceipt(payload.receipt, receiptCents(payload.amount)) }, initial, 'confirm', saveId.current);
      onClose();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const groups = new Map();
  for (const item of payload?.receipt.items || []) {
    const category = item.category || '其他';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return <Modal title={initial ? editing ? '修改小票' : '小票详情' : '小票识别'} onClose={busy && payload ? () => {} : onClose} wide>
    <div className="receipt-content">
      {!initial && <><div className="receipt-upload">
        <button className="secondary" disabled={busy} onClick={() => camera.current.click()}><Camera size={19} />拍照</button>
        <button className="secondary" disabled={busy} onClick={() => album.current.click()}><ImagePlus size={19} />从相册选择</button>
        <input ref={camera} hidden aria-label="拍摄小票" type="file" accept="image/*" capture="environment" onChange={selectFile} />
        <input ref={album} hidden aria-label="上传小票图片" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} />
      </div><p className="receipt-privacy">图片将发送至已配置的 AI 服务识别，本 App 不保存原图。请遮挡会员号、支付账号等敏感信息。</p></>}
      {preview && <details className="receipt-image"><summary>查看原图</summary><img src={preview} alt="待核对的小票原图" /></details>}
      {busy && !payload && <p className="receipt-progress" role="status"><LoaderCircle size={18} className="spin" />正在识别小票…<button type="button" className="text-button" onClick={onClose}>取消识别</button></p>}
      {error && <div className="error-box" role="alert">{error}</div>}
      {payload && <form className="receipt-form" onSubmit={save}>
        {editing ? <fieldset disabled={busy} className="receipt-fields">
          <label>账目名称<input value={payload.title} maxLength={160} required onChange={e => change('title', e.target.value)} /></label>
          <div className="form-columns"><label>购买日期<DateInput type="date" required value={payload.date} onChange={e => change('date', e.target.value)} /></label>
            <label>整笔分类<select value={payload.category} onChange={e => change('category', e.target.value)}>{[...new Set([...CATEGORIES, payload.category])].map(name => <option key={name}>{name}</option>)}</select></label></div>
          <label>实付金额（元）<input type="number" inputMode="decimal" min=".01" max="1000000" step=".01" required value={payload.amount} onChange={e => change('amount', e.target.value)} /></label>
        </fieldset> : <div className="receipt-overview"><ReceiptText size={24} /><div><h2>{payload.title}</h2><small>{payload.date} · {payload.category} · {payload.receipt.items.length} 项商品</small></div><strong>{amountLabel(payload.amount)}</strong></div>}
        {editing && warnings.length > 0 && <div className="receipt-warnings"><strong>识别待核对</strong><ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
        {[...groups].map(([category, items]) => <section className="receipt-group" key={category} aria-label={`${category}商品`}>
          <h3><CategoryIcon category={category} size={17} />{category}<span>{items.length} 项</span></h3>
          {items.map(item => <div className="receipt-item" key={item._key}>
            <div className="receipt-item-line"><div><strong>{item.name || '名称待核对'}</strong><small>数量 {item.quantity || '待核对'} {item.unit}</small></div><strong>{amountLabel(item.amount)}</strong>
              {editing && <button type="button" className="icon-button" aria-label={`编辑商品${item.name || '未命名'}`} title="编辑商品" disabled={busy} onClick={() => setOpenItem(openItem === item._key ? null : item._key)}><Pencil size={16} /></button>}
            </div>
            {editing && openItem === item._key && <fieldset className="receipt-item-edit" disabled={busy}>
              <label>商品名称<input value={item.name} required maxLength={120} onChange={e => changeItem(item._key, { name: e.target.value })} /></label>
              <div className="form-columns"><label>数量<input type="number" min=".001" max="100000" step=".001" required value={item.quantity} onChange={e => changeItem(item._key, { quantity: e.target.value })} /></label>
                <label>小计（元）<input type="number" inputMode="decimal" min="0" max="1000000" step=".01" required value={item.amount} onChange={e => changeItem(item._key, { amount: e.target.value })} /></label></div>
              <div className="form-columns"><label>品类<select value={item.category} onChange={e => changeItem(item._key, { category: e.target.value })}>{[...new Set([...CATEGORIES.filter(v => v !== '工资'), item.category])].map(name => <option key={name}>{name}</option>)}</select></label>
                <label>单位<input value={item.unit} maxLength={10} onChange={e => changeItem(item._key, { unit: e.target.value })} /></label></div>
              <button type="button" className="text-button danger" onClick={() => changeReceipt('items', payload.receipt.items.filter(row => row._key !== item._key))}><Trash2 size={16} />删除此项</button>
            </fieldset>}
          </div>)}
        </section>)}
        {editing && <><button type="button" className="text-button" disabled={busy || payload.receipt.items.length >= 100} onClick={() => {
          const item = { _key: requestId(), name: '', quantity: '', unit: '', amount: '', category: '其他' };
          changeReceipt('items', [...payload.receipt.items, item]); setOpenItem(item._key);
        }}><Plus size={16} />补充商品</button>
          <fieldset className="receipt-fields" disabled={busy}><div className="form-columns">
            <label>整单优惠 / 补差（元）<input type="number" step=".01" required value={payload.receipt.adjustmentAmount} onChange={e => changeReceipt('adjustmentAmount', e.target.value)} /></label>
            <label>调整说明<input value={payload.receipt.adjustmentLabel} placeholder="优惠填负数，无调整填 0" maxLength={60} onChange={e => changeReceipt('adjustmentLabel', e.target.value)} /></label>
          </div></fieldset>
          {validation && <p className="error-box" role="alert">{validation}</p>}
          <label className="receipt-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />已核对商品、日期和实付金额，整张小票计为一笔支出</label>
        </>}
        {!editing && Number(payload.receipt.adjustmentAmount) !== 0 && <p className="receipt-adjustment">{payload.receipt.adjustmentLabel} <strong>{amountLabel(payload.receipt.adjustmentAmount)}</strong></p>}
        <div className="modal-actions">{editing ? <><button className="secondary" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy || !checked || Boolean(validation)}><Check size={17} />{initial ? '保存修改' : '确认入账'}</button></>
          : <button className="secondary" type="button" onClick={() => setEditing(true)}><Pencil size={16} />修改小票</button>}</div>
      </form>}
    </div>
  </Modal>;
}
