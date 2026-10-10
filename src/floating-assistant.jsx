import React, { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { registerPlugin } from '@capacitor/core';
import { getBase, getToken, isNative } from './api';
import './floating-assistant.css';
import animationDurations from './assistant-animation-durations.json';
import { createPlayback, createCenterPlayback, createCenterIdlePlayback, centerRestStep, wakePlayback } from './assistant-playback.mjs';
import { dockAssistant, releaseAssistant, ASSISTANT_CENTER_SIZE } from './assistant-docking.mjs';
import centerDurations from './assistant-center-durations.json';
import centerActions from './assistant-center-actions.json';
import { AssistantFrames } from './assistant-frames';

export const NativeAssistant = registerPlugin('FloatingAssistant');
export const overlaySession = window.__ZAIZAI_OVERLAY__ || null;

export function AssistantBackdrop({ open, userId }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!isNative || overlaySession) return;
    let active = true, revision = 0;
    const handles = [];
    const sync = async () => {
      const current = ++revision;
      try {
        const state = await NativeAssistant.status({ userId });
        if (active && current === revision) setExpanded(Boolean(state.running && state.expanded));
      } catch { if (active && current === revision) setExpanded(false); }
    };
    for (const name of ['presentation', 'foreground']) {
      NativeAssistant.addListener(name, sync).then(handle => {
        if (active) { handles.push(handle); sync(); } else handle.remove();
      }).catch(() => {});
    }
    sync();
    return () => { active = false; handles.forEach(handle => handle.remove()); };
  }, [userId]);
  if (overlaySession || (!open && !expanded)) return null;
  return <div className="assistant-backdrop" aria-hidden="true" />;
}

// Mount inside the app-lock boundary so pending actions wait for unlock.
export function AssistantMainActions({ userId, onAction }) {
  const callback = useRef(onAction);
  callback.current = onAction;
  useEffect(() => {
    if (!isNative || overlaySession) return;
    let active = true, listener, consuming = false;
    const consume = async () => {
      if (!active || consuming || document.hidden) return;
      consuming = true;
      try {
        const { action } = await NativeAssistant.consumeMainAction({ userId, base: getBase() });
        if (active && ['add', 'receipt', 'ledger', 'tasks', 'health', 'mine'].includes(action)) callback.current(action);
      } catch { /* Older installed native hosts do not expose this method. */ }
      finally { consuming = false; }
    };
    NativeAssistant.addListener('foreground', consume).then(handle => {
      if (active) { listener = handle; consume(); } else handle.remove();
    }).catch(() => {});
    window.addEventListener('focus', consume);
    document.addEventListener('visibilitychange', consume);
    return () => { active = false; listener?.remove(); window.removeEventListener('focus', consume); document.removeEventListener('visibilitychange', consume); };
  }, [userId]);
  return null;
}

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

export function AssistantEdge({ onOpen, active, unread, nativeDock, concealed = false, label }) {
  const [position, setPosition] = useState(null);
  const [smoke, setSmoke] = useState(0);
  const [playback, setPlayback] = useState(() => ({
    steps: createPlayback(animationDurations), index: 0, round: Date.now(),
  }));
  const currentStep = playback.steps[playback.index];
  const playbackSrc = currentStep.src.endsWith('.png') ? currentStep.src : `${currentStep.src}?play=${playback.round}-${playback.index}`;
  const playbackTimer = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const interacting = useRef(false);
  const previousSignals = useRef({ active, unread });
  const sleeping = ['yawn', 'sleep', 'asleep'].includes(currentStep.name);
  function wake() {
    if (!sleeping) return;
    window.clearTimeout(playbackTimer.current);
    setPlayback(previous => wakePlayback(previous));
  }
  useEffect(() => {
    if (!nativeDock) return;
    window.addEventListener('assistant-touch', wake);
    return () => window.removeEventListener('assistant-touch', wake);
  }, [nativeDock, sleeping]);
  useEffect(() => {
    const previous = previousSignals.current;
    previousSignals.current = { active, unread };
    if ((active && !previous.active) || unread > previous.unread) {
      if (sleeping) {
        window.clearTimeout(playbackTimer.current);
        setPlayback(value => wakePlayback(value));
      }
    }
  }, [active, unread, sleeping]);
  useEffect(() => {
    const resize = () => setPosition(previous => previous ? dockAssistant(previous.x, previous.y, innerWidth, innerHeight, previous.dock) : null);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => () => window.clearTimeout(playbackTimer.current), []);
  useEffect(() => {
    if (position?.dock !== 'center') return;
    const interrupt = event => {
      if (event.type === 'pointermove' && !event.buttons) return;
      if (event.type === 'pointerdown') interacting.current = true;
      if (['pointerup', 'pointercancel', 'blur'].includes(event.type)) interacting.current = false;
      window.clearTimeout(playbackTimer.current);
      setSmoke(0);
      setPlayback(previous => ({ steps: [centerRestStep()], index: 0, round: previous.round + 1 }));
    };
    const events = ['pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'touchmove', 'keydown', 'input', 'wheel', 'scroll', 'blur'];
    for (const event of events) window.addEventListener(event, interrupt, { capture: true, passive: true });
    return () => {
      interacting.current = false;
      for (const event of events) window.removeEventListener(event, interrupt, true);
    };
  }, [position?.dock]);
  function schedulePlayback() {
    window.clearTimeout(playbackTimer.current);
    playbackTimer.current = window.setTimeout(() => {
      setPlayback(previous => previous !== playback ? previous
        : position?.dock === 'center' && (interacting.current || drag.current)
        ? { steps: [centerRestStep()], index: 0, round: previous.round + 1 }
        : previous.index + 1 < previous.steps.length
        ? { ...previous, index: previous.index + 1 }
        : { steps: position?.dock === 'center' ? createCenterPlayback(centerDurations, centerActions) : createPlayback(animationDurations), index: 0, round: previous.round + 1 });
    }, currentStep.delay);
  }
  function finishDrag(event) {
    const started = drag.current;
    drag.current = null;
    if (!started || !moved.current) return;
    const next = releaseAssistant(started.left + event.clientX - started.x, started.top + event.clientY - started.y, innerWidth, innerHeight, started.dock);
    setPosition(next);
    if ((next.dock === 'center') !== (started.dock === 'center')) {
      window.clearTimeout(playbackTimer.current);
      setPlayback(previous => ({
        steps: next.dock === 'center' ? createCenterIdlePlayback(centerDurations) : createPlayback(animationDurations),
        index: 0, round: previous.round + 1,
      }));
      setSmoke(next.dock === 'center' ? Date.now() : 0);
    }
  }
  return <button className={`assistant-edge${concealed ? ' is-concealed' : ''}${nativeDock ? ` dock-${nativeDock}` : position ? ` dock-${position.dock}` : ''}${active ? ' in-call' : ''}`}
    style={{ '--assistant-center-size': `${ASSISTANT_CENTER_SIZE}px`, ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {}) }}
    aria-label={label || (active ? '展开通话助手' : '展开助手')} title={label || (active ? '通话中，点击展开' : '展开助手')}
    onPointerDown={event => {
      if (nativeDock) return;
      if (event.button !== 0) return;
      wake();
      const box = event.currentTarget.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, dock: position?.dock || 'right', previous: position };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > 5) moved.current = true;
      if (moved.current) setPosition({
        dock: drag.current.dock,
        x: drag.current.left + dx,
        y: drag.current.top + dy,
      });
    }}
    onPointerUp={finishDrag}
    onPointerCancel={() => { if (drag.current) setPosition(drag.current.previous); drag.current = null; moved.current = true; }}
    onClick={() => { if (!moved.current) { wake(); onOpen(); } moved.current = false; }}>
    {position?.dock === 'center'
      ? <AssistantFrames src={playbackSrc} requestKey={`${playback.round}-${playback.index}`} onReady={schedulePlayback} />
      : <img key={`${playback.round}-${playback.index}`} data-current="true" src={playbackSrc} onLoad={schedulePlayback} alt="" aria-hidden="true" />}
    {smoke > 0 && <span key={smoke} className="assistant-smoke" aria-hidden="true" onAnimationEnd={() => setSmoke(0)}>
      {[0, 1, 2, 3, 4, 5].map(index => <span key={index} style={{ '--puff-angle': `${index * 60}deg` }} />)}
    </span>}
    {active && <Mic className="assistant-edge-status" size={13} aria-hidden="true" />}
    {unread > 0 && <i aria-label={`${unread} 条未读`} />}
  </button>;
}
