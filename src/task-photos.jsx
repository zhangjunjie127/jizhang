import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { request } from './api';

async function preparePhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('请选择20MB以内的图片');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('无法读取图片，请使用JPG、PNG或WebP格式'); }
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.88, .76, .62, .48]) {
      const image = canvas.toDataURL('image/jpeg', quality);
      if (image.length <= 850000) return image;
    }
    throw new Error('图片细节过多，请裁剪后重新选择');
  } finally { bitmap.close(); }
}

export function TaskPhotos({ photos, onChange, disabled, onBusyChange }) {
  const camera = useRef(null), album = useRef(null), dialog = useRef(null);
  const grid = useRef(null), revealPhoto = useRef(false);
  const [images, setImages] = useState({});
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useLayoutEffect(() => {
    if (!revealPhoto.current) return;
    revealPhoto.current = false;
    grid.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [photos]);
  useEffect(() => {
    let active = true;
    for (const id of photos.filter(value => !value.startsWith('data:'))) {
      request(`/task-photos/${id}`).then(photo => { if (active) setImages(current => ({ ...current, [id]: photo.image })); })
        .catch(() => { if (active) setError('部分照片加载失败，请重新打开记录重试'); });
    }
    return () => { active = false; };
  }, [photos]);
  useEffect(() => {
    if (!preview) return;
    const element = dialog.current;
    element.showModal();
    // Keep the outer form's native focus trap and Escape handler out of this dialog.
    const stop = event => event.stopPropagation();
    element.addEventListener('keydown', stop);
    return () => element.removeEventListener('keydown', stop);
  }, [preview]);
  async function choose(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    if (files.length + photos.length > 6) { setError('每条记录最多添加6张照片'); return; }
    setLoading(true); onBusyChange(true); setError('');
    try {
      const added = [];
      for (const file of files) added.push(await preparePhoto(file));
      revealPhoto.current = true;
      onChange([...new Set([...photos, ...added])]);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); onBusyChange(false); }
  }
  return <section className="task-photos">
    <div className="task-photo-heading"><h3>拍照留档</h3><span>{photos.length}/6</span></div>
    <input hidden ref={camera} aria-label="拍摄留档照片" type="file" accept="image/*" capture="environment" onChange={choose} />
    <input hidden ref={album} aria-label="选择留档照片" type="file" accept="image/*" multiple onChange={choose} />
    <div className="task-photo-actions">
      <button type="button" disabled={disabled || loading || photos.length >= 6} onClick={() => camera.current.click()}><Camera size={18} />拍照</button>
      <button type="button" disabled={disabled || loading || photos.length >= 6} onClick={() => album.current.click()}><ImagePlus size={18} />相册上传</button>
    </div>
    <div ref={grid} className="task-photo-grid">{photos.map((photo, index) => {
      const image = photo.startsWith('data:') ? photo : images[photo];
      return <div key={photo} className="task-photo-item">
        <button type="button" aria-label={`查看留档照片${index + 1}`} disabled={!image} onClick={() => setPreview(image)}>
          {image ? <img src={image} alt={`留档照片${index + 1}`} /> : <span>加载中</span>}
        </button>
        <button type="button" className="task-photo-remove" aria-label={`移除留档照片${index + 1}`} title="移除照片" disabled={disabled || loading} onClick={() => onChange(photos.filter((_, i) => i !== index))}><X size={16} /></button>
      </div>;
    })}</div>
    {loading && <span role="status">正在处理照片…</span>}
    {error && <p className="error-box" role="alert">{error}</p>}
    {preview && <dialog ref={dialog} className="task-photo-preview" aria-label="留档照片预览" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); setPreview(''); }}>
      <button type="button" aria-label="关闭照片预览" title="关闭照片预览" onClick={() => setPreview('')}><X size={24} /></button>
      <img src={preview} alt="留档照片大图" />
    </dialog>}
  </section>;
}
