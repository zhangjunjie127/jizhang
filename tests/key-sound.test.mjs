import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachKeySounds } from '../src/key-sound.mjs';

function setup({ suspended = false, resume, fail = false } = {}) {
  const stats = { contexts: 0, tones: 0, closed: 0 };
  let listener;
  const parameter = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  class Audio {
    constructor() { stats.contexts++; if (fail) throw Error('unavailable'); this.state = suspended ? 'suspended' : 'running'; this.currentTime = 0; }
    async resume() { if (resume) await resume(); this.state = 'running'; }
    async close() { this.state = 'closed'; stats.closed++; }
    createOscillator() { return { frequency: parameter, connect() {}, disconnect() {}, start() { stats.tones++; }, stop(at) { assert.equal(at, .04); } }; }
    createGain() { return { gain: parameter, connect() {}, disconnect() {} }; }
  }
  const document = {
    hidden: false, call: false,
    querySelector() { return this.call; },
    addEventListener(type, handler) { listener = handler; },
    removeEventListener(type, handler) { if (listener === handler) listener = null; },
  };
  const dispose = attachKeySounds(document, Audio);
  async function click({ trusted = true, disabled = false, button = true, off = false } = {}) {
    const control = { matches: () => disabled, getAttribute: () => off ? '按键音' : '', checked: false };
    await listener?.({ isTrusted: trusted, target: { closest: () => button ? control : null } });
  }
  return { document, stats, dispose, click };
}
test('key sound is lazy, quiet-length, rate-limited and disposed', async () => {
  const { stats, click, dispose } = setup();
  assert.equal(stats.contexts, 0);
  await click();
  assert.equal(stats.tones, 1);
  await click();
  assert.equal(stats.tones, 1);
  dispose();
  await click();
  assert.equal(stats.closed, 1);
  assert.equal(stats.tones, 1);
});
test('hidden pages, calls, disabled controls, script clicks and turning sound off remain silent', async () => {
  for (const options of [{ trusted: false }, { disabled: true }, { button: false }, { off: true }]) {
    const fixture = setup();
    await fixture.click(options);
    assert.equal(fixture.stats.contexts, 0);
    fixture.dispose();
  }
  for (const flag of ['hidden', 'call']) {
    const fixture = setup();
    fixture.document[flag] = true;
    await fixture.click();
    assert.equal(fixture.stats.contexts, 0);
    fixture.dispose();
  }
});
test('audio failures do not reject the UI action', async () => {
  const fixture = setup({ fail: true });
  await assert.doesNotReject(fixture.click());
  fixture.dispose();
});
test('switching off while audio resumes prevents a late sound', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const fixture = setup({ suspended: true, resume: () => waiting });
  const click = fixture.click();
  fixture.dispose();
  release();
  await click;
  assert.equal(fixture.stats.tones, 0);
});
