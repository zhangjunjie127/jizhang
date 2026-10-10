import test from 'node:test';
import assert from 'node:assert/strict';
import { dockAssistant, releaseAssistant, ASSISTANT_WIDTH, ASSISTANT_HEIGHT, ASSISTANT_CENTER_SIZE } from '../src/assistant-docking.mjs';

test('left, right and bottom docking preserve size and stay inside the viewport', () => {
  for (const [width, height] of [[390, 844], [320, 568], [1280, 720]]) {
    assert.equal(dockAssistant(0, 100, width, height).dock, 'left');
    assert.equal(dockAssistant(width - ASSISTANT_WIDTH, 100, width, height).dock, 'right');
    for (const x of [-100, 100, width + 100]) {
      const bottom = dockAssistant(x, height - 50, width, height);
      assert.equal(bottom.dock, 'bottom');
      assert.equal(bottom.y + ASSISTANT_HEIGHT, height);
      assert.ok(bottom.x >= 0 && bottom.x + ASSISTANT_WIDTH <= width);
    }
    const resized = dockAssistant(1000, 800, width, height, 'bottom');
    assert.equal(resized.y + ASSISTANT_HEIGHT, height);
    assert.ok(resized.x + ASSISTANT_WIDTH <= width);
    assert.equal(dockAssistant(30, 100, width, height).dock, 'left');
  }
});
test('release keeps interior position and restores docking near any supported edge', () => {
  assert.deepEqual(releaseAssistant(140, 300, 390, 844), { dock: 'center', x: 140, y: 300 });
  assert.equal(releaseAssistant(10, 300, 390, 844).dock, 'left');
  assert.equal(releaseAssistant(310, 300, 390, 844).dock, 'right');
  assert.equal(releaseAssistant(140, 800, 390, 844).dock, 'bottom');
  const resized = dockAssistant(500, 900, 320, 568, 'center');
  assert.equal(resized.dock, 'center');
  assert.equal(ASSISTANT_CENTER_SIZE, 93.6);
  assert.ok(resized.x + ASSISTANT_CENTER_SIZE <= 320);
  assert.ok(resized.y + ASSISTANT_CENTER_SIZE <= 568);
  assert.equal(releaseAssistant(280, 300, 390, 844, 'center').dock, 'right');
  assert.equal(releaseAssistant(140, 730, 390, 844, 'center').dock, 'bottom');
});
