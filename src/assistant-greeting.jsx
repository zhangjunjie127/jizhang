import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { request } from './api';

export function AssistantGreeting({ userId, enabled, onOpen, onReceived }) {
  const [text, setText] = useState('');
  const [bounds, setBounds] = useState(null);
  const bubble = useRef(null);
  const received = useRef(onReceived);
  received.current = onReceived;
  useEffect(() => {
    setText('');
    if (!enabled || !userId) return;
    let stopped = false, timer, dismissTimer, controller, lastTouch = Date.now();
    const touch = event => {
      if (event.target.closest?.('.assistant-greeting')) return;
      lastTouch = Date.now(); setText('');
    };
    const visibility = () => { if (document.hidden) setText(''); };
    const poll = async () => {
      if (!document.hidden && Date.now() - lastTouch >= 60000) {
        controller = new AbortController();
        try {
          const result = await request('/assistant/greeting', { method: 'POST', body: {},
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]) });
          if (!stopped && !document.hidden && Date.now() - lastTouch >= 60000 && result.greeting) {
            setText(result.greeting.text);
            received.current?.();
            dismissTimer = setTimeout(() => setText(''), 15000);
          }
        } catch { /* Offline and aborted requests stay silent; no canned fallback. */ }
      }
      if (!stopped) timer = setTimeout(poll, 300000);
    };
    timer = setTimeout(poll, 60000);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      clearTimeout(timer); clearTimeout(dismissTimer); controller?.abort();
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, userId]);
  useLayoutEffect(() => {
    if (!text || !enabled) return;
    const place = () => {
      const cat = document.querySelector('.assistant-edge')?.getBoundingClientRect();
      const box = bubble.current?.getBoundingClientRect();
      if (!cat || !box) return;
      const left = cat.left < innerWidth / 2;
      setBounds({
        left: Math.max(8, Math.min(left ? cat.right : cat.left - box.width, innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(cat.top + (cat.height - box.height) / 2, innerHeight - box.height - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [text, enabled]);
  if (!enabled || !text) return null;
  return <div ref={bubble} className="assistant-greeting" role="status" aria-label="助手问候"
    style={bounds || { visibility: 'hidden' }} onPointerDown={event => event.stopPropagation()}>
    <button className="assistant-greeting-text" onClick={() => { setText(''); onOpen(); }}>{text}</button>
    <button className="assistant-greeting-dismiss" aria-label="收起问候" title="收起问候" onClick={() => setText('')}><X size={17} /></button>
  </div>;
}
