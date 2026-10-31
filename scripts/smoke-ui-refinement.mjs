import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'zaizai-ui-refinement-'));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
    INVITE_CODE: 'ui-fixture', CPA_API_KEY: '', CPA_BASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
const stage = process.env.UI_STAGE === 'before' ? 'before' : 'after';
const output = `artifacts/ui-refinement/${stage}`;
mkdirSync(output, { recursive: true });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });
  const response = await fetch(`${base}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ui-fixture', password: 'UiFixture123!',
      name: '界面测试', birthday: '2000-01-01', invite: 'ui-fixture' }),
  });
  assert.ok(response.ok);
  const { token, user } = await response.json();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ base, token }) => {
    localStorage.setItem('zaizai-server', base);
    localStorage.setItem('zaizai-token', token);
  }, { base, token });
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:5173');
    const nav = page.locator(width > 760 ? '.sidebar' : '.mobile-nav');
    for (const [name, selector, slug] of [
      ['记账', '.ledger-page', 'ledger'], ['待办', '.planner-page', 'planner'],
      ['健康', '.health-tile-grid', 'health'], ['我的', '.mine-home', 'mine'],
    ]) {
      await nav.getByRole('button', { name, exact: true }).click();
      await page.locator(selector).waitFor();
      await page.waitForTimeout(550);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${width}: page overflow`);
      await page.screenshot({ path: `${output}/${slug}-${width}.png` });
    }
    await page.locator('.assistant-edge').evaluate(el => el.click());
    const panel = page.getByRole('dialog', { name: '助手对话', exact: true });
    await panel.waitFor();
    await page.waitForFunction(() => document.querySelector('.assistant-panel').getAnimations().length === 0);
    await panel.getByRole('textbox').fill('今天的安排');
    if (stage === 'after') {
      for (const label of ['拍照识别小票', '添加记录', '收起助手']) {
        const target = await panel.getByRole('button', { name: label, exact: true }).boundingBox();
        assert.ok(target.width >= 44 && target.height >= 44, `${label}: touch target`);
      }
    }
    const input = await panel.getByRole('textbox').boundingBox();
    assert.ok(input.width >= 80 && input.y + input.height <= height, `Composer fits at ${width}`);
    await page.screenshot({ path: `${output}/assistant-${width}.png` });
    await panel.getByRole('button', { name: '收起助手' }).click();
    await panel.waitFor({ state: 'detached' });
    await nav.getByRole('button', { name: '健康', exact: true }).click();
    await page.getByRole('button', { name: '添加早餐', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    if (width === 320) {
      await dialog.locator('.wheel-date-input').first().click();
      const dateDialog = page.locator('.unified-date-dialog');
      await dateDialog.waitFor();
      await page.waitForTimeout(300);
      const monthWheel = dateDialog.locator('.date-wheel').nth(1);
      const monthBefore = await monthWheel.evaluate(el => el.scrollTop);
      const wheelResult = await monthWheel.evaluate(el => {
        let canceled = false;
        for (let index = 0; index < 3; index += 1) {
          const event = new WheelEvent('wheel', { deltaY: 35, bubbles: true, cancelable: true });
          canceled = !el.dispatchEvent(event);
        }
        return { canceled, kinetic: el.classList.contains('is-kinetic') };
      });
      await page.waitForTimeout(450);
      const monthAfter = await monthWheel.evaluate(el => el.scrollTop);
      assert.ok(monthAfter > monthBefore, `Date wheel responds to smooth mouse-wheel input (${monthBefore} -> ${monthAfter}; ${JSON.stringify(wheelResult)})`);
      assert.equal(wheelResult.canceled, true, 'Custom wheel motion prevents competing browser-native scrolling');
      assert.equal(Math.round(monthAfter / 40), await monthWheel.locator('[aria-selected="true"]').evaluate(el => [...el.parentElement.children].indexOf(el)),
        'Date wheel settles on the selected tick');
      await monthWheel.evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(60);
      await monthWheel.evaluate(el => {
        const dispatch = (type, clientY) => el.dispatchEvent(new PointerEvent(type, {
          pointerId: 77, pointerType: 'touch', button: 0, clientY, bubbles: true,
        }));
        dispatch('pointerdown', 100);
        dispatch('pointermove', 120);
      });
      await page.waitForTimeout(80);
      assert.notEqual(await monthWheel.evaluate(el => getComputedStyle(el).transform), 'none', 'Touching past the boundary triggers a bounce');
      await page.waitForTimeout(600);
      assert.equal(await monthWheel.evaluate(el => getComputedStyle(el).transform), 'none', 'Boundary bounce cleans up its transform');
      await dateDialog.getByRole('button', { name: '关闭日期选择', exact: true }).click();
    }
    await page.screenshot({ path: `${output}/form-${width}.png` });
    const formFits = await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    if (stage === 'after') assert.ok(formFits, `Form fits at ${width}`);
    else if (!formFits) console.log(`Baseline: form overflows at ${width}px`);
    const search = dialog.getByRole('textbox', { name: '搜索食物', exact: true });
    await search.focus();
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Keyboard stays in dialog');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['blue', 'green', 'rose']) {
    await page.evaluate(({ id, theme }) => {
      localStorage.setItem(`zaizai-preferences-${id}`, JSON.stringify({ theme }));
    }, { id: user.id, theme });
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.locator('.mine-home').waitFor();
    await page.screenshot({ path: `${output}/theme-${theme}.png` });
    await page.locator('.mobile-nav').getByRole('button', { name: '健康', exact: true }).click();
    await page.getByRole('button', { name: '添加早餐', exact: true }).click();
    const cancel = page.getByRole('dialog').getByRole('button', { name: '取消', exact: true });
    await page.keyboard.press('Tab');
    await cancel.focus();
    assert.notEqual(await cancel.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await cancel.click();
  }
  await page.locator('.mobile-nav').getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('tab', { name: '课程', exact: true }).click();
  await page.getByRole('button', { name: '添加周四第5节课程', exact: true }).click();
  const course = page.getByRole('dialog', { name: '新建课程', exact: true });
  await course.waitFor();
  assert.ok(await course.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Course editor fits');
  await course.getByRole('button', { name: '取消', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.assistant-edge').evaluate(el => el.click());
  assert.equal(await page.locator('.assistant-backdrop').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log(`PASS: four pages, assistant composer, health form and reduced motion. Screenshots: ${output}`);
} finally {
  await browser?.close();
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true });
}
