import React, { useLayoutEffect, useRef, useState } from 'react';

// Keep a decoded frame visible until its replacement is ready.
export function AssistantFrames({ src, requestKey, onReady }) {
  const [frames, setFrames] = useState([{ src, ready: false }]);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const target = useRef(src);
  target.current = src;
  const callback = useRef(onReady);
  callback.current = onReady;
  const notified = useRef(null);
  const cleanupTimer = useRef(null);
  function notify() {
    if (notified.current === requestKey) return;
    notified.current = requestKey;
    callback.current();
  }
  useLayoutEffect(() => {
    window.clearTimeout(cleanupTimer.current);
    const loaded = framesRef.current.find(frame => frame.src === src && frame.ready);
    if (loaded) {
      setFrames([loaded]);
      notify();
      return;
    }
    setFrames(previous => {
      const last = previous.findLast(frame => frame.ready);
      return [...(last ? [last] : []), { src, ready: false }];
    });
    return () => window.clearTimeout(cleanupTimer.current);
  }, [src, requestKey]);
  const current = frames.find(frame => frame.src === src && frame.ready)
    || frames.findLast(frame => frame.ready);
  return frames.map(frame => <img key={frame.src} src={frame.src}
    className="assistant-buffered-frame"
    data-current={frame === current ? 'true' : 'false'}
    style={{ opacity: frame === current ? 1 : 0 }}
    onLoad={() => {
      if (target.current !== frame.src) return;
      setFrames(previous => previous.map(item => item.src === frame.src ? { ...item, ready: true } : item));
      notify();
      cleanupTimer.current = window.setTimeout(() => {
        setFrames(previous => previous.filter(item => item.src === target.current));
      }, 120);
    }}
    onError={() => { if (target.current === frame.src) notify(); }}
    alt="" aria-hidden="true" />);
}
