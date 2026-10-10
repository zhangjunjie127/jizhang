import React, { useLayoutEffect, useRef, useState } from 'react';
import { exactMoney, moneyLabels } from '../shared/money.mjs';
import './money-amount.css';

export function MoneyAmount({ cents, prefix = '', hidden = false, className = '' }) {
  const container = useRef(null);
  const [display, setDisplay] = useState({ text: '', scale: 1 });
  useLayoutEffect(() => {
    const element = container.current;
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:max-content;white-space:pre;visibility:hidden;transform:scale(0);transform-origin:0 0;pointer-events:none';
    document.body.append(probe);
    let alive = true;
    const measure = () => {
      if (!alive || !element.clientWidth) return;
      const style = getComputedStyle(element);
      // Measure with the rendered font, including tabular digits, rather than canvas metrics.
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariantNumeric', 'fontFeatureSettings', 'letterSpacing']) {
        probe.style[property] = style[property];
      }
      const textWidth = text => { probe.textContent = text; return probe.offsetWidth; };
      const labels = hidden ? ['****'] : moneyLabels(cents, prefix);
      const width = element.clientWidth;
      const text = labels.find(label => textWidth(label) <= width - 1) || labels.at(-1);
      const scale = Math.min(1, (width - 1) / Math.max(1, textWidth(text)));
      setDisplay(previous => previous.text === text && previous.scale === scale ? previous : { text, scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    document.fonts.ready.then(measure);
    return () => { alive = false; observer.disconnect(); probe.remove(); };
  }, [cents, prefix, hidden]);
  const label = hidden ? '金额已隐藏' : `${prefix}${exactMoney(cents)} 元`;
  return <span ref={container} className={`money-amount ${className}`} title={label} aria-label={label}>
    <span className="money-value" style={{ fontSize: `${display.scale}em` }}>{display.text || (hidden ? '****' : `${prefix}${exactMoney(cents)}`)}</span>
  </span>;
}
