import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif' }[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 63, height: 63 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    window.catState = { dock: 'right', expanded: false, active: false };
    window.ZaizaiCat = {
      ready() { window.dispatchEvent(new CustomEvent('assistant-cat-state', { detail: window.catState })); },
      toggle() { window.catState.expanded = !window.catState.expanded; this.ready(); },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/assistant-cat.html`);
  const cat = page.locator('.assistant-edge');
  await cat.waitFor();
  await page.waitForFunction(() => document.querySelector('.assistant-edge img')?.naturalWidth > 0);
  await page.evaluate(() => { window.originalCat = document.querySelector('.assistant-edge'); });
  for (const dock of ['left', 'right']) {
    await page.evaluate(dock => {
      window.catState.dock = dock;
      window.ZaizaiCat.ready();
    }, dock);
    await page.locator(`.assistant-edge.dock-${dock}`).waitFor();
    const original = await cat.boundingBox();
    for (let i = 0; i < 6; i++) {
      await cat.click();
      await page.getByRole('button', { name: i % 2 === 0 ? '收起助手' : '展开助手', exact: true }).waitFor();
      assert.deepEqual(await cat.boundingBox(), original, `${dock}: no movement during toggle`);
      assert.equal(await cat.isVisible(), true);
      assert.equal(await page.evaluate(() => window.originalCat === document.querySelector('.assistant-edge')), true);
    }
    await cat.click();
    await page.screenshot({ path: `artifacts/native-cat-open-${dock}.png` });
    await cat.click();
  }
  await page.evaluate(() => { window.catState.active = true; window.ZaizaiCat.ready(); });
  await page.locator('.assistant-edge.in-call').waitFor();
  await page.evaluate(() => { window.catState.unread = 2; window.ZaizaiCat.ready(); });
  await page.locator('.assistant-edge i[aria-label="2 条未读"]').waitFor();
  assert.equal(await page.locator('.assistant-panel').count(), 0, 'Cat surface has no chat session');
  assert.equal(requests.some(url => url.includes('/api/') || url.includes('/voice')), false, 'No authenticated requests from the cat renderer');
  assert.deepEqual(errors, []);
  console.log('PASS: packaged native cat renderer stays visible and stationary on both docks across toggles; call state updates; no second chat/API session. Native WindowManager touch/z-order still needs a device.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
