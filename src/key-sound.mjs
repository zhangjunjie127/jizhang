// One short, quiet tone per deliberate UI activation; never play into a call.
export function attachKeySounds(document, AudioContext) {
  if (!AudioContext) return () => {};
  let context;
  let disposed = false;
  let lastTap = -Infinity;
  async function tap(event) {
    if (!event.isTrusted || document.hidden || document.querySelector('.has-call')) return;
    const control = event.target.closest?.('button,input[type="checkbox"],input[type="radio"]');
    if (!control || control.matches(':disabled,[aria-disabled="true"]')) return;
    if (control.getAttribute('aria-label') === '按键音' && !control.checked) return;
    const now = performance.now();
    if (now - lastTap < 35) return;
    lastTap = now;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') await context.resume();
      if (disposed || context.state !== 'running' || document.hidden || document.querySelector('.has-call') || performance.now() - now > 200) return;
      const tone = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      tone.type = 'sine';
      tone.frequency.setValueAtTime(1200, start);
      tone.frequency.exponentialRampToValueAtTime(850, start + .035);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.018, start + .003);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .035);
      tone.connect(gain);
      gain.connect(context.destination);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(start);
      tone.stop(start + .04);
    } catch {
      // Audio restrictions must not block the underlying button action.
    }
  }
  document.addEventListener('click', tap, true);
  return () => {
    disposed = true;
    document.removeEventListener('click', tap, true);
    if (context && context.state !== 'closed') context.close().catch(() => {});
  };
}
