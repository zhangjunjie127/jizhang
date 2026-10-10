import { useLayoutEffect, useRef } from 'react';

export function panelEdgeTransform(panel, edge) {
  return `translate(${edge.x - panel.x}px, ${edge.y - panel.y}px) scale(${edge.width / panel.width}, ${edge.height / panel.height})`;
}

export function cornerPanelQuad(panel, edge, progress) {
  const anchorX = edge.x + edge.width / 2 >= panel.x + panel.width / 2 ? 1 : 0;
  const anchorY = edge.y + edge.height / 2 >= panel.y + panel.height / 2 ? 1 : 0;
  const pinch = .62 * Math.sin(Math.PI * progress);
  const x = (edge.x - panel.x) * progress, y = (edge.y - panel.y) * progress;
  const width = panel.width + (edge.width - panel.width) * progress;
  const height = panel.height + (edge.height - panel.height) * progress;
  // Retreat the two adjacent corners, leaving a narrow tip pointing at the cat.
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [
    x + (u + (u === anchorX && v !== anchorY ? (1 - 2 * anchorX) * pinch : 0)) * width,
    y + (v + (v === anchorY && u !== anchorX ? (1 - 2 * anchorY) * pinch : 0)) * height,
  ]);
}

export function quadTransform(quad, width, height) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  // Rectangle-to-quadrilateral homography, in CSS column-major order.
  return `matrix3d(${[
    (x1 - x0 + g * x1) / width, (y1 - y0 + g * y1) / width, 0, g / width,
    (x3 - x0 + h * x3) / height, (y3 - y0 + h * y3) / height, 0, h / height,
    0, 0, 1, 0, x0, y0, 0, 1,
  ].join(',')})`;
}

export function softPanelPath(w, h, progress) {
  const bend = progress > 0 && progress < 1 ? Math.sin(Math.PI * progress) : 0;
  const bow = Math.min(w, h) * .065 * bend;
  const r = 8 + Math.min(w, h) * .02 * bend;
  // Shallow inward curves with horizontal/vertical tangents at the rounded corners.
  return `path("M ${r} 0
    C ${w * .25} 0 ${w * .3} ${bow} ${w / 2} ${bow}
    C ${w * .7} ${bow} ${w * .75} 0 ${w - r} 0 Q ${w} 0 ${w} ${r}
    C ${w} ${h * .25} ${w - bow} ${h * .3} ${w - bow} ${h / 2}
    C ${w - bow} ${h * .7} ${w} ${h * .75} ${w} ${h - r} Q ${w} ${h} ${w - r} ${h}
    C ${w * .75} ${h} ${w * .7} ${h - bow} ${w / 2} ${h - bow}
    C ${w * .3} ${h - bow} ${w * .25} ${h} ${r} ${h} Q 0 ${h} 0 ${h - r}
    C 0 ${h * .75} ${bow} ${h * .7} ${bow} ${h / 2}
    C ${bow} ${h * .3} 0 ${h * .25} 0 ${r} Q 0 0 ${r} 0 Z")`.replace(/\s+/g, ' ');
}

export function cornerPanelFrames(panel, edge, open) {
  return Array.from({ length: 41 }, (_, index) => {
    const offset = index / 40;
    const time = open ? 1 - offset : offset;
    const progress = time ** 3 * (time * (6 * time - 15) + 10);
    return {
      offset, transform: quadTransform(cornerPanelQuad(panel, edge, progress), panel.width, panel.height),
      clipPath: softPanelPath(panel.width, panel.height, progress),
      opacity: 1 - .95 * Math.max(0, (progress - .8) / .2),
    };
  });
}

export function useAssistantPanelMotion(open, setOpen, nativeHost) {
  const panel = useRef(null);
  const animation = useRef(null);
  const closing = useRef(false);
  function cancel() {
    if (animation.current) {
      animation.current.onfinish = null;
      animation.current.cancel();
      animation.current = null;
    }
  }
  function frames(open) {
    const edge = document.querySelector('.assistant-edge');
    return edge && panel.current ? cornerPanelFrames(
      panel.current.getBoundingClientRect(), edge.getBoundingClientRect(), open,
    ) : null;
  }
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useLayoutEffect(() => {
    if (nativeHost || !open || !panel.current) return;
    closing.current = false;
    const from = frames(true);
    if (from && !reduced()) {
      animation.current = panel.current.animate(from, { duration: 500, fill: 'both' });
      animation.current.onfinish = cancel;
    }
    const resize = () => {
      cancel();
      if (closing.current) setOpen(false);
    };
    window.addEventListener('resize', resize);
    return () => {
      cancel();
      closing.current = false;
      window.removeEventListener('resize', resize);
    };
  }, [open, nativeHost, setOpen]);
  function collapse() {
    if (closing.current) return;
    if (!panel.current || reduced()) { setOpen(false); return; }
    if (animation.current && ['running', 'paused'].includes(animation.current.playState)) {
      closing.current = true;
      animation.current.onfinish = () => setOpen(false);
      animation.current.reverse();
      return;
    }
    cancel();
    const to = frames(false);
    if (!to) { setOpen(false); return; }
    closing.current = true;
    animation.current = panel.current.animate(to, { duration: 460, fill: 'forwards' });
    animation.current.onfinish = () => setOpen(false);
  }
  return { panelRef: panel, collapse };
}
