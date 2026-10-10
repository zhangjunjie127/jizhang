import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createPlayback, createCenterPlayback, createCenterIdlePlayback, centerRestStep, centerSequences, sequences, wakePlayback } from '../src/assistant-playback.mjs';

const durations = JSON.parse(readFileSync(new URL('../src/assistant-animation-durations.json', import.meta.url)));
test('both center idle animations use finite playback and the existing pause interval', () => {
  const durations = JSON.parse(readFileSync(new URL('../src/assistant-center-durations.json', import.meta.url)));
  for (const roll of [0, 0.99]) {
    const [step] = createCenterIdlePlayback(durations, () => roll);
    assert.equal(step.name, 'center-idle');
    assert.equal(step.plays, roll === 0 ? 1 : 2);
    assert.ok(existsSync(new URL(`../public${step.src}`, import.meta.url)));
    assert.equal(step.delay, 4160 * step.plays + 10000 + roll * 10000);
  }
});
test('five center sequences retain order, reach twice, sleep for at least five seconds', () => {
  const idle = JSON.parse(readFileSync(new URL('../src/assistant-center-durations.json', import.meta.url)));
  const actions = JSON.parse(readFileSync(new URL('../src/assistant-center-actions.json', import.meta.url)));
  for (let index = 0; index < 5; index++) {
    for (const random of [0, 0.999]) {
      let calls = 0;
      const steps = createCenterPlayback(idle, actions, () => calls++ === 0 ? (index + 0.1) / 5 : random);
      assert.deepEqual(steps.slice(0, -1).map(step => step.name.replace('center-', '')), centerSequences[index]);
      assert.equal(steps.at(-1).name, 'center-rest');
      for (const step of steps) {
        assert.ok(existsSync(new URL(`../public${step.src}`, import.meta.url)));
        assert.ok(Number.isFinite(step.delay));
        if (step.name === 'center-reach') {
          assert.equal(step.plays, 2);
          assert.equal(step.delay, actions.reach * 2);
        }
        if (['center-sleep', 'center-doze'].includes(step.name)) assert.ok(step.delay >= 5000);
      }
    }
  }
  assert.match(centerRestStep().src, /center-cat-idle\.png$/);
});
test('all seven ordered sequences have correct assets and idle only after the sequence', () => {
  const rolls = [0.61, 0.68, 0.3, 0.75, 0.82, 0.89, 0.96];
  for (const [index, roll] of rolls.entries()) {
    let calls = 0;
    const steps = createPlayback(durations, () => calls++ === 0 ? roll : 0.9);
    if (index === 1) {
      assert.deepEqual(steps.map(step => step.name), ['yawn', 'sleep', 'asleep', 'awake']);
      assert.equal(steps[1].plays, 1);
      assert.equal(steps[1].delay, 1550);
      assert.equal(steps[2].delay, 19000);
      assert.match(steps[2].src, /asleep\.png$/);
      assert.match(steps[3].src, /idle\.png$/);
      for (const step of steps) assert.ok(existsSync(new URL(`../public${step.src}`, import.meta.url)));
      continue;
    }
    assert.deepEqual(steps.map(step => step.name), sequences[index]);
    for (const [position, step] of steps.entries()) {
      assert.ok(existsSync(new URL(`../public${step.src}`, import.meta.url)));
      const duration = step.name === 'idle' ? 0 : durations[step.src.replace(/-(once|twice)\.gif$/, '.gif')] * step.plays;
      assert.equal(step.delay - duration, position === steps.length - 1 ? 19000 : 0);
      assert.equal(step.plays, step.name === 'wash' ? 1 : step.name === 'idle' ? 0 : 2);
    }
  }
});
test('touch or AI wake interrupts sleep with open eyes and invalidates the old round', () => {
  for (const name of ['yawn', 'sleep', 'asleep']) {
    const previous = { steps: [{ name }], index: 0, round: 100 };
    const next = wakePlayback(previous, () => 0);
    assert.equal(next.round, 101);
    assert.equal(next.steps[0].name, 'awake');
    assert.equal(next.steps[0].delay, 10000);
    assert.match(next.steps[0].src, /idle\.png$/);
  }
  const awake = { steps: [{ name: 'blink' }], index: 0, round: 5 };
  assert.equal(wakePlayback(awake), awake);
});
test('blink/idle receives 60% weight and remaining choices remain reachable', () => {
  const counts = new Map();
  for (let index = 0; index < 1000; index++) {
    let calls = 0;
    const steps = createPlayback(durations, () => calls++ === 0 ? index / 1000 : 0);
    const key = steps.map(step => step.name).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
    assert.equal(steps.at(-1).delay >= 10000, true);
  }
  assert.equal(counts.get('blink,idle'), 600);
  assert.equal(counts.size, 7);
});
