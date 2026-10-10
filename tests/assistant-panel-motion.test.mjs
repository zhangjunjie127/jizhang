import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelEdgeTransform, cornerPanelQuad, quadTransform, cornerPanelFrames, softPanelPath } from '../src/assistant-panel-motion.js';

test('panel transforms target the original cat rectangle on every dock and in the center', () => {
  const panel = { x: 8, y: 130, width: 374, height: 570 };
  for (const edge of [
    { x: 0, y: 300, width: 62.4, height: 62.4 },
    { x: 327.6, y: 420, width: 62.4, height: 41.6 },
    { x: 150, y: 802.4, width: 62.4, height: 41.6 },
    { x: 148, y: 380, width: 93.6, height: 93.6 },
  ]) {
    const [dx, dy, sx, sy] = panelEdgeTransform(panel, edge).match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.ok(Math.abs(panel.x + dx - edge.x) < 0.001);
    assert.ok(Math.abs(panel.y + dy - edge.y) < 0.001);
    assert.ok(Math.abs(panel.width * sx - edge.width) < 0.001);
    assert.ok(Math.abs(panel.height * sy - edge.height) < 0.001);
  }
});

test('soft edges curve inward only during motion and return to the original outline', () => {
  const start = softPanelPath(374, 570, 0);
  const middle = softPanelPath(374, 570, .5);
  assert.equal(start, softPanelPath(374, 570, 1));
  assert.notEqual(middle, start);
  assert.equal((middle.match(/ C /g) || []).length, 8);
  const open = cornerPanelFrames({ x: 8, y: 130, width: 374, height: 570 },
    { x: 327.6, y: 730, width: 62.4, height: 62.4 }, true);
  assert.equal(open[0].clipPath, start);
  assert.equal(open.at(-1).clipPath, start);
  assert.equal(open[20].clipPath, middle);
});

test('corner suction maps all corners without folding, reverses exactly and never inflates', () => {
  const panel = { x: 8, y: 130, width: 374, height: 570 };
  for (const edge of [
    { x: 0, y: 200, width: 62.4, height: 62.4 },
    { x: 327.6, y: 200, width: 62.4, height: 62.4 },
    { x: 0, y: 730, width: 62.4, height: 62.4 },
    { x: 327.6, y: 730, width: 62.4, height: 62.4 },
    { x: 150, y: 800, width: 62.4, height: 41.6 },
    { x: 150, y: 350, width: 93.6, height: 93.6 },
  ]) {
    const opening = cornerPanelFrames(panel, edge, true);
    const closing = cornerPanelFrames(panel, edge, false);
    assert.equal(opening[0].transform, closing.at(-1).transform);
    assert.equal(opening.at(-1).transform, closing[0].transform);
    assert.ok(opening.every(frame => !('borderRadius' in frame)));
    for (let step = 0; step <= 100; step++) {
      const progress = step / 100;
      const quad = cornerPanelQuad(panel, edge, progress);
      const matrix = quadTransform(quad, panel.width, panel.height).slice(9, -1).split(',').map(Number);
      const source = [[0, 0], [panel.width, 0], [panel.width, panel.height], [0, panel.height]];
      for (let i = 0; i < 4; i++) {
        const [x, y] = source[i], [qx, qy] = quad[i];
        const divisor = matrix[3] * x + matrix[7] * y + 1;
        assert.ok(divisor > 0, 'No perspective singularity');
        assert.ok(Math.abs((matrix[0] * x + matrix[4] * y + matrix[12]) / divisor - qx) < .001);
        assert.ok(Math.abs((matrix[1] * x + matrix[5] * y + matrix[13]) / divisor - qy) < .001);
        const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
        assert.ok((b[0] - qx) * (c[1] - b[1]) - (b[1] - qy) * (c[0] - b[0]) > 0, 'Convex, not folded');
        assert.ok(qx + panel.x >= Math.min(panel.x, edge.x) - .001);
        assert.ok(qx + panel.x <= Math.max(panel.x + panel.width, edge.x + edge.width) + .001);
        assert.ok(qy + panel.y >= Math.min(panel.y, edge.y) - .001);
        assert.ok(qy + panel.y <= Math.max(panel.y + panel.height, edge.y + edge.height) + .001);
      }
    }
    assert.equal(opening.at(-1).opacity, 1);
  }
});
