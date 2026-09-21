import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const state = {
  user: { id: 'keyboard-test', name: '测试', persona: 'gentle', relationship: 'friend', adult: true },
  records: [{
    id: 'keyboard-draft', kind: 'expense', status: 'pending', revision: 1,
    created: '2026-09-17T00:00:00Z',
    payload: { title: '键盘测试', category: '其他', date: '2026-09-17', amount: '20', cents: 2000, direction: 'expense' },
  }], messages: [], memories: [],
};
mkdirSync('artifacts', { recursive: true });
async function setup(page) {
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'keyboard-fixture-only'));
}
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  await page.goto(`${base}/preview.html`);
  const app = page.frameLocator('iframe');
  for (const size of ['390,844', '360,800', '320,740']) {
    await page.getByLabel('手机屏幕尺寸').selectOption(size);
    await app.locator('.nav-create').click();
    await app.getByRole('button', { name: '支出', exact: true }).click();
    await app.getByRole('button', { name: '午餐', exact: true }).click();
    const input = app.locator('input[name="amount"]');
    await input.click();
    const keyboard = app.getByRole('region', { name: '数字键盘' });
    await keyboard.waitFor();
    for (const key of ['1', '2', '小数点', '3', '4']) await keyboard.getByRole('button', { name: key, exact: true }).click();
    assert.equal(await input.inputValue(), '12.34');
    assert.equal(await input.evaluate(el => el.checkValidity()), true);
    await keyboard.getByRole('button', { name: '小数点', exact: true }).click();
    assert.equal(await input.inputValue(), '12.34');
    await keyboard.getByRole('button', { name: '删除一位' }).click();
    assert.equal(await input.inputValue(), '12.3');
    await keyboard.getByRole('button', { name: '5', exact: true }).click();
    assert.equal(await input.evaluate(el => new FormData(el.form).get('amount')), '12.35');
    const modalBox = await app.locator('.modal').boundingBox();
    const inputBox = await input.boundingBox();
    const keyboardBox = await keyboard.boundingBox();
    assert.ok(modalBox.y + modalBox.height <= keyboardBox.y);
    assert.ok(inputBox.y + inputBox.height <= keyboardBox.y);
    await page.screenshot({ path: `artifacts/preview-keyboard-${size.split(',')[0]}.png` });
    await keyboard.getByRole('button', { name: '完成' }).click();
    await keyboard.waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), '12.35');
    await input.click();
    await input.fill('9.50');
    assert.equal(await keyboard.getByLabel('当前输入金额').textContent(), '9.50');
    await input.press('Escape');
    await keyboard.waitFor({ state: 'hidden' });
    assert.equal(await app.locator('.modal').count(), 1);
    await input.click();
    await app.locator('input[name="title"]').click();
    await keyboard.waitFor({ state: 'hidden' });
    const textKeyboard = app.getByRole('region', { name: '文字键盘' });
    await textKeyboard.waitFor();
    const note = app.locator('input[name="title"]');
    await note.fill('午饭');
    await note.evaluate(el => el.setSelectionRange(1, 1));
    await textKeyboard.getByRole('button', { name: 'a', exact: true }).click();
    assert.equal(await note.inputValue(), '午a饭');
    await textKeyboard.getByRole('button', { name: '删除一位' }).click();
    assert.equal(await note.inputValue(), '午饭');
    await note.fill('午饭🥗');
    await textKeyboard.getByRole('button', { name: '删除一位' }).click();
    assert.equal(await note.inputValue(), '午饭');
    await textKeyboard.getByRole('button', { name: '空格', exact: true }).click();
    await textKeyboard.getByRole('button', { name: '大写字母' }).click();
    await textKeyboard.getByRole('button', { name: 'A', exact: true }).click();
    await textKeyboard.getByRole('button', { name: '切换数字和符号' }).click();
    await textKeyboard.getByRole('button', { name: '1', exact: true }).click();
    assert.equal(await note.inputValue(), '午饭 A1');
    await textKeyboard.getByRole('button', { name: '切换字母' }).click();
    await page.screenshot({ path: `artifacts/preview-text-keyboard-${size.split(',')[0]}.png` });
    const noteBox = await note.boundingBox();
    const textKeyboardBox = await textKeyboard.boundingBox();
    assert.ok(noteBox.y + noteBox.height <= textKeyboardBox.y);
    await textKeyboard.getByRole('button', { name: '完成' }).click();
    await textKeyboard.waitFor({ state: 'hidden' });
    await input.click();
    await app.getByRole('button', { name: '关闭', exact: true }).click();
    await app.locator('.modal').waitFor({ state: 'hidden' });
    await keyboard.waitFor({ state: 'hidden' });
    assert.equal(await app.locator('body').evaluate(el => el.classList.contains('preview-keyboard-open')), false);
  }
  await app.getByRole('button', { name: /批量核对账目/ }).click();
  const batchAmount = app.getByLabel('第1笔金额');
  await batchAmount.click();
  const batchKeyboard = app.getByRole('region', { name: '数字键盘' });
  await batchKeyboard.getByRole('button', { name: '1', exact: true }).click();
  assert.equal(await batchAmount.inputValue(), '201');
  // Trigger a separate React update to ensure the controlled value was saved in state.
  await batchKeyboard.getByRole('button', { name: '完成' }).click();
  await app.getByLabel('第1笔备注').fill('受控输入测试');
  assert.equal(await batchAmount.inputValue(), '201');
  await app.getByRole('button', { name: '关闭', exact: true }).click();
  // A real touch-device browser must keep its native decimal keyboard.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await setup(mobile);
  await mobile.goto(`${base}/?preview=phone`);
  await mobile.locator('.nav-create').tap();
  await mobile.getByRole('button', { name: '支出', exact: true }).tap();
  await mobile.getByRole('button', { name: '午餐', exact: true }).tap();
  await mobile.locator('input[name="amount"]').tap();
  assert.equal(await mobile.locator('.preview-keyboard').count(), 0);
  assert.equal(await mobile.locator('input[name="amount"]').getAttribute('inputmode'), 'decimal');
  assert.deepEqual(errors, []);
  console.log('PASS: preview keypad, decimal/delete/done, physical input, Escape, blur/close cleanup, 320/360/390px layout, and touch-device exclusion. No financial data written.');
} finally {
  await browser.close();
}
