import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__assistant-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0;background:#eef3f8"><div id="fixture"></div></body></html>',
  }));
  await page.goto('http://127.0.0.1:5173/__assistant-fixture');
  await page.clock.install();
  await page.evaluate(async () => {
    const source = await (await fetch('/src/floating-assistant.jsx')).text();
    const main = await (await fetch('/src/main.jsx')).text();
    const React = (await import(source.match(/from "([^"]*\/react\.js[^"]*)"/)[1])).default;
    const reactDOM = await import(main.match(/from "([^"]*react-dom_client[^"]*)"/)[1]);
    const createRoot = reactDOM.createRoot || reactDOM.default.createRoot;
    const { AssistantEdge } = await import('/src/floating-assistant.jsx');
    Math.random = () => 0.68;
    const root = createRoot(document.getElementById('fixture'));
    window.props = { active: false, unread: 0, onOpen() {} };
    window.renderAssistant = updates => {
      Object.assign(window.props, updates);
      root.render(React.createElement(AssistantEdge, window.props));
    };
    window.renderAssistant({});
  });
  const image = page.locator('.assistant-edge>img[data-current="true"]');
  const waitImage = async name => {
    await page.waitForFunction(name => {
      const image = document.querySelector('.assistant-edge>img[data-current="true"]');
      return image?.src.includes(name) && image.complete && image.naturalWidth > 0;
    }, name);
    await page.clock.runFor(1);
  };
  const sleep = async () => {
    await waitImage('new-cat-03');
    await page.clock.runFor(3840);
    await waitImage('sleep-entry');
    await page.clock.runFor(1550);
    await waitImage('asleep.png');
  };
  await sleep();
  // Bottom docking, touch wake and retained left/right orientations.
  const box = await page.locator('.assistant-edge').boundingBox();
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  await waitImage('idle.png');
  await page.mouse.move(195, 830, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator('.dock-bottom').count(), 1);
  const bounds = await image.boundingBox();
  assert.ok(Math.abs(bounds.y + bounds.height - 844) < 1);
  assert.equal(await image.evaluate(element => getComputedStyle(element).transform), 'none');
  await page.screenshot({ path: `${process.env.TEMP}/assistant-bottom-check.png` });
  await page.clock.runFor(16800);
  await sleep();
  await page.evaluate(() => window.renderAssistant({ unread: 1 }));
  await waitImage('idle.png');
  await page.clock.runFor(16800);
  await sleep();
  await page.clock.runFor(16800);
  await waitImage('idle.png');
  for (const x of [10, 380]) {
    const box = await page.locator('.assistant-edge').boundingBox();
    await page.mouse.move(box.x + 15, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(x, 350, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.locator(x === 10 ? '.dock-left' : '.dock-right').count(), 1);
  }
  const sideBox = await page.locator('.assistant-edge').boundingBox();
  await page.mouse.move(sideBox.x + 15, sideBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(195, 400, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator('.dock-center').count(), 1);
  await waitImage('center-cat-');
  const fullBody = await page.locator('.assistant-edge').boundingBox();
  assert.ok(Math.abs(fullBody.width - 93.6) < 0.1);
  assert.ok(Math.abs(fullBody.height - 93.6) < 0.1);
  assert.equal(await page.locator('.assistant-smoke').count(), 1);
  await page.clock.runFor(150);
  await page.screenshot({ path: `${process.env.TEMP}/assistant-center-smoke-check.png` });
  await page.clock.runFor(700);
  await page.locator('.assistant-smoke').waitFor({ state: 'detached', timeout: 3000 });
  await page.screenshot({ path: `${process.env.TEMP}/assistant-center-check.png` });
  // Every center action can be cancelled without consuming the page interaction.
  await page.evaluate(() => { Math.random = () => 0.01; });
  await page.mouse.click(20, 20);
  await waitImage('center-cat-idle.png');
  await page.clock.runFor(10100);
  await waitImage('center-action-lie-sleep-once');
  await page.clock.runFor(2470);
  await waitImage('center-action-sleep-loop');
  await page.clock.runFor(5000);
  assert.match(await image.getAttribute('src'), /sleep-loop/);
  await page.keyboard.press('a');
  await waitImage('center-cat-idle.png');
  await page.evaluate(() => { window.restImage = document.querySelector('.assistant-edge>img[data-current="true"]'); });
  await page.clock.runFor(6000);
  assert.match(await image.getAttribute('src'), /center-cat-idle\.png/);

  await page.evaluate(() => { Math.random = () => 0.41; });
  await page.mouse.wheel(0, 100);
  await waitImage('center-cat-idle.png');
  assert.ok(await page.evaluate(() => window.restImage === document.querySelector('.assistant-edge>img[data-current="true"]')),
    'Repeated interactions must retain the already decoded idle image');
  await page.clock.runFor(14100);
  await waitImage('center-cat-01-once');
  let releaseWave;
  const waveGate = new Promise(resolve => { releaseWave = resolve; });
  await page.route('**/center-action-wave-once.gif?*', async route => {
    await waveGate;
    await route.continue();
  });
  const waveRequest = page.waitForRequest(request => request.url().includes('center-action-wave-once'));
  await page.clock.runFor(4160);
  await waveRequest;
  assert.ok(await page.locator('.assistant-edge img').evaluateAll(images => images.some(image =>
    image.complete && image.naturalWidth > 0 && Number(getComputedStyle(image).opacity) > 0)),
  'The previous frame must remain visible while the next animation is loading');
  releaseWave();
  await waitImage('center-action-wave-once');
  const waveBox = await image.boundingBox();
  const actorBox = await page.locator('.assistant-edge').boundingBox();
  assert.ok(Math.abs(waveBox.x + waveBox.width / 2 - actorBox.x - actorBox.width / 2) < 0.1);
  assert.ok(Math.abs(waveBox.y + waveBox.height - actorBox.y - actorBox.height - actorBox.height / 6) < 0.1);
  await page.clock.runFor(4160);
  await waitImage('center-cat-01-once');

  await page.evaluate(() => { Math.random = () => 0.61; });
  await page.mouse.click(20, 20);
  await waitImage('center-cat-idle.png');
  await page.clock.runFor(16100);
  await waitImage('center-cat-01-once');
  await page.clock.runFor(4160);
  await waitImage('center-action-reach-twice');
  await page.clock.runFor(4260);
  await waitImage('center-cat-01-once');
  const centerBox = await page.locator('.assistant-edge').boundingBox();
  await page.mouse.move(centerBox.x + 15, centerBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(380, 350, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator('.dock-right').count(), 1);
  await waitImage('new-cat-');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.runFor(20);
  const resized = await image.boundingBox();
  assert.ok(resized.x >= 0 && resized.x + resized.width <= 1281);
  assert.deepEqual(errors, []);
  console.log('PASS: docking, wake conditions, center idle, smoke, return to edge and resize');
} finally {
  await browser.close();
}
