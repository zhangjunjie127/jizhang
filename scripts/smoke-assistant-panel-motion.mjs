import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {
    user: { id: 'motion-fixture', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
    records: [], messages: [], memories: [],
  } }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'motion-fixture'));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  const edge = page.locator('.assistant-edge');
  await edge.waitFor();
  const panel = page.locator('.assistant-panel');
  const settle = () => page.waitForFunction(() =>
    [...document.querySelectorAll('.assistant-panel,.assistant-backdrop')].every(el => el.getAnimations().length === 0));
  for (const [dock, x, y] of [
    ['left', 10, 350], ['right', 380, 350], ['left', 10, 730], ['right', 380, 730],
    ['bottom', 195, 830], ['center', 195, 400],
  ]) {
    const start = await edge.boundingBox();
    await page.mouse.move(start.x + 15, start.y + 15);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.up();
    await page.locator(`.assistant-edge.dock-${dock}`).waitFor();
    const original = await edge.boundingBox();
    await page.evaluate(() => { window.originalCat = document.querySelector('.assistant-edge'); });
    // DOM click avoids advancing the animation while Playwright waits for stability.
    await edge.evaluate(el => el.click());
    await panel.waitFor({ state: 'attached' });
    const opening = await panel.evaluate(el => {
      const animation = el.getAnimations()[0];
      animation.pause(); animation.currentTime = 0;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(opening[key] - original[key]) < 1, `${dock} opening ${key}`);
    const tapered = await panel.evaluate(el => {
      const animation = el.getAnimations()[0];
      animation.currentTime = animation.effect.getTiming().duration * .52;
      return {
        radius: getComputedStyle(el).borderTopLeftRadius, frames: animation.effect.getKeyframes().length,
        clip: getComputedStyle(el).clipPath,
      };
    });
    assert.equal(tapered.frames, 41);
    assert.equal(tapered.radius, '8px');
    assert.match(tapered.clip, /^path\(/, 'The browser applies the curved outline');
    await page.screenshot({ path: `artifacts/assistant-corner-opening-${dock}.png` });
    await panel.evaluate(el => el.getAnimations()[0].finish());
    await settle();
    assert.equal(await panel.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '8px');
    assert.equal(await panel.evaluate(el => getComputedStyle(el).clipPath), 'none', 'No residual clipping after opening');
    assert.equal(await panel.locator('.messages').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(220, 231, 239)',
      'Assistant conversation has a distinct background from the white main pages');
    assert.notEqual(await panel.evaluate(el => getComputedStyle(el).boxShadow), 'none',
      'Expanded panel casts an outer shadow');
    const frost = page.locator('.assistant-backdrop');
    assert.equal(await frost.evaluate(el => getComputedStyle(el).backdropFilter), 'blur(12px)');
    assert.deepEqual(await frost.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
    assert.equal(await panel.evaluate(el => getComputedStyle(el).filter), 'none', 'Only background is blurred');
    await page.getByRole('button', { name: '收起助手', exact: true }).evaluate(el => el.click());
    await panel.evaluate(el => {
      const animation = el.getAnimations()[0];
      animation.pause(); animation.currentTime = animation.effect.getTiming().duration * .6;
    });
    const fits = await panel.evaluate(el => {
      const animation = el.getAnimations()[0];
      for (let step = 0; step <= 20; step++) {
        animation.currentTime = animation.effect.getTiming().duration * step / 20;
        const rect = el.getBoundingClientRect();
        if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) return false;
      }
      animation.currentTime = animation.effect.getTiming().duration * .6;
      return true;
    });
    assert.equal(fits, true, `${dock}: the corner suction stays inside the screen`);
    await page.screenshot({ path: `artifacts/assistant-corner-closing-${dock}.png` });
    const ending = await panel.evaluate(el => {
      const animation = el.getAnimations()[0];
      animation.pause(); animation.currentTime = animation.effect.getTiming().duration;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(ending[key] - original[key]) < 1, `${dock} closing ${key}`);
    await panel.evaluate(el => el.getAnimations()[0].finish());
    await panel.waitFor({ state: 'detached' });
    await edge.waitFor();
    assert.equal(await page.evaluate(() => window.originalCat === document.querySelector('.assistant-edge')), true);
    assert.deepEqual(await edge.boundingBox(), original);
  }
  await edge.evaluate(el => el.click());
  await panel.waitFor({ state: 'attached' });
  await panel.evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause(); animation.currentTime = 180;
  });
  const interruption = await page.getByRole('button', { name: '收起助手', exact: true }).evaluate(el => {
    const panel = document.querySelector('.assistant-panel');
    const before = panel.getBoundingClientRect().toJSON();
    el.click(); el.click();
    return { before, after: panel.getBoundingClientRect().toJSON() };
  });
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(interruption.before[key] - interruption.after[key]) < 1, `No jump when reversing: ${key}`);
  }
  await panel.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.assistant-backdrop').count(), 0, 'Minimizing restores the main page');
  await edge.waitFor();
  await edge.evaluate(el => el.click());
  await panel.waitFor({ state: 'attached' });
  await page.setViewportSize({ width: 320, height: 700 });
  await settle();
  await page.screenshot({ path: 'artifacts/assistant-panel-motion-mobile.png' });
  await page.getByRole('button', { name: '收起助手', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await edge.click();
  await panel.waitFor();
  assert.equal(await panel.evaluate(el => el.getAnimations().length), 0);
  await page.getByRole('button', { name: '收起助手', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await edge.click();
  await settle();
  await page.screenshot({ path: 'artifacts/assistant-panel-motion-desktop.png' });
  await page.getByRole('button', { name: '收起助手', exact: true }).evaluate(el => el.click());
  await panel.evaluate(el => {
    const animation = el.getAnimations()[0];
    animation.pause(); animation.currentTime = animation.effect.getTiming().duration * .6;
  });
  await page.screenshot({ path: 'artifacts/assistant-panel-motion-midpoint.png' });
  await page.setViewportSize({ width: 768, height: 844 });
  await panel.waitFor({ state: 'detached' });
  await edge.waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: panel expands/collapses to the same cat on all four docks; rapid minimize, resize and reduced motion.');
} finally { await browser.close(); }
