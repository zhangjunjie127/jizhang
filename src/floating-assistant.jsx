import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Mic } from 'lucide-react';
import { registerPlugin } from '@capacitor/core';
import { getBase, getToken, isNative } from './api';
import './floating-assistant.css';

export const NativeAssistant = registerPlugin('FloatingAssistant');
export const overlaySession = window.__ZAIZAI_OVERLAY__ || null;

export function DesktopAssistantLifecycle({ userId, suspended, onRunningChange }) {
  const callback = useRef(onRunningChange);
  callback.current = onRunningChange;
  useEffect(() => {
    if (!isNative || overlaySession || suspended) return;
    let active = true, busy = false, listener;
    const sync = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const result = localStorage.getItem(`zaizai-desktop-assistant-${userId}`) === 'false'
          ? await NativeAssistant.status()
          : await NativeAssistant.show({ token: getToken(), base: getBase(), userId, restore: true });
        if (active) callback.current(Boolean(result.running));
      } catch { if (active) callback.current(false); }
      finally { busy = false; }
    };
    sync();
    NativeAssistant.addListener('foreground', sync).then(handle => {
      if (active) listener = handle;
      else handle.remove();
    }).catch(() => {});
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      active = false;
      listener?.remove();
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [userId, suspended]);
  return null;
}

export function AssistantEdge({ onOpen, active, unread }) {
  const [position, setPosition] = useState(null);
  const drag = useRef(null);
  const moved = useRef(false);
  function clamp(x, y) {
    return { x: x < innerWidth / 2 ? -20 : innerWidth - 28, y: Math.max(16, Math.min(innerHeight - 148, y)) };
  }
  useEffect(() => {
    const resize = () => setPosition(previous => previous ? clamp(previous.x, previous.y) : null);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <button className={`assistant-edge${position?.x < 0 ? ' dock-left' : ''}${active ? ' in-call' : ''}`}
    style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
    aria-label={active ? '展开通话助手' : '展开助手'} title={active ? '通话中，点击展开' : '展开助手'}
    onPointerDown={event => {
      if (event.button !== 0) return;
      const box = event.currentTarget.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > 5) moved.current = true;
      if (moved.current) setPosition(clamp(drag.current.left + dx, drag.current.top + dy));
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; moved.current = true; }}
    onClick={() => { if (!moved.current) onOpen(); moved.current = false; }}>
    {active ? <Mic size={23} /> : <MessageCircle size={25} />}
    {unread > 0 && <i aria-label={`${unread} 条未读`} />}
  </button>;
}
