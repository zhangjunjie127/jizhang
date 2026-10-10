import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('new assistant variants have finite loops and retained black-cat assets', () => {
  const durations = JSON.parse(readFileSync(new URL('../src/assistant-animation-durations.json', import.meta.url)));
  assert.equal(Object.keys(durations).length, 7);
  for (const [path, duration] of Object.entries(durations)) {
    assert.ok(duration > 0);
    for (const variant of ['once', 'twice']) {
      const data = readFileSync(new URL(`../public${path.replace('.gif', `-${variant}.gif`)}`, import.meta.url));
      assert.equal(data.readUInt16LE(6), 288);
      assert.equal(data.readUInt16LE(8), 192);
      const loop = data.indexOf('NETSCAPE2.0');
      if (variant === 'once') assert.equal(loop, -1);
      else {
        assert.ok(loop > 0);
        assert.equal(data.readUInt16LE(loop + 13), 1);
      }
      assert.equal(data.at(-1), 0x3b);
    }
  }
  for (let index = 1; index <= 3; index++) {
    assert.ok(existsSync(new URL(`../public/assistant-gifs/assistant-0${index}.gif`, import.meta.url)));
  }
});
