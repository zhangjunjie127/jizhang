import React, { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Save, Watch } from 'lucide-react';
import { request } from './api';
import { HEALTH_METRICS } from '../shared/health-sync.mjs';

export function HealthSync({ userId }) {
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setMessage('');
    request('/health/sync', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setData(result);
      setMetrics(result.metrics);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [userId, reload]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request('/health/sync', { method: 'PUT', body: { metrics, revision: data.revision } });
      setData(result);
      setMetrics(result.metrics);
      setMessage('同步偏好已保存到账号，尚未开启设备同步');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="health-sync">
    {error && <div className="health-error" role="alert">{error}<button type="button" disabled={busy} className="secondary" onClick={() => setReload(n => n + 1)}>重新加载</button></div>}
    {!data && !error && <p className="health-loading" role="status"><LoaderCircle size={20} className="spin" />正在加载同步设置</p>}
    {data && <>
      <section className="health-section" aria-label="健康数据来源">
        {data.sources.map(source => <div className="health-sync-source" key={source.id}>
          <Watch size={22} aria-hidden="true" />
          <div><strong>{source.name}</strong><small>最近同步：从未同步</small></div>
          <span>暂未接入</span>
        </div>)}
        <button type="button" className="secondary" disabled><RefreshCw size={16} />立即同步</button>
      </section>
      <form onSubmit={save}>
        <fieldset disabled={busy} className="health-sync-options">
          <legend>同步项目偏好</legend>
          {Object.entries(HEALTH_METRICS).map(([key, label]) => <label key={key}>
            <input type="checkbox" checked={metrics.includes(key)} onChange={e => {
              setMessage('');
              setMetrics(current => e.target.checked ? [...current, key] : current.filter(item => item !== key));
            }} />{label}
          </label>)}
        </fieldset>
        <p className="health-caution">当前仅保存项目偏好，不读取设备数据。平台接入后，需另行授权读取及上传健康数据。</p>
        <div className="health-sync-privacy"><span>健康数据云端授权</span><strong>未授权</strong></div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存偏好
        </button>
      </form>
      {message && <p className="health-status" role="status">{message}</p>}
    </>}
  </div>;
}
