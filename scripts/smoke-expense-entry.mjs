import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const expenseCategories = '早餐 午餐 晚餐 蔬菜 水果 零食 交通 旅行 汽车 快递 购物 日用 住房 居家 服饰 数码 宠物 维修 运动 医疗 美容 孩子 长辈 社交 礼金 礼物 捐赠 亲友 通讯 书籍 学习 办公 娱乐 烟酒 彩票 还贷 其他'.split(' ');
const user = { id: 'entry-test', name: '测试', persona: 'gentle', relationship: 'friend', adult: true };
const legacy = { id: 'legacy', kind: 'expense', status: 'confirmed', revision: 3, created: `${today}T00:00:00Z`, payload: { amount: 88, cents: 8800, category: '餐饮', direction: 'expense', title: '旧分类账目', date: today } };
let records = [], writes = [], failNext = false;
const snapshot = () => ({ user, records, messages: [], memories: [] });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: snapshot() }));
  await page.route('**/api/records**', async route => {
    const request = route.request();
    if (!['POST', 'PATCH'].includes(request.method())) return route.fulfill({ json: snapshot() });
    const body = request.postDataJSON();
    writes.push({ body, path: new URL(request.url()).pathname, method: request.method() });
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: '测试保存失败' } }); }
    const id = new URL(request.url()).pathname.split('/')[3] || `new-${writes.length}`;
    const saved = { id, kind: 'expense', status: 'confirmed', revision: 4, created: `${today}T00:00:00Z`, payload: { ...body.payload, amount: Number(body.payload.amount), cents: Math.round(Number(body.payload.amount) * 100) } };
    records = [...records.filter(item => item.id !== id), saved];
    return route.fulfill({ json: snapshot() });
  });
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'entry-fixture-only'));
  for (const width of [320, 390, 1366]) {
    records = [];
    writes = [];
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    if (await page.locator('.add-menu').isVisible()) await page.locator('.add-menu').getByRole('button', { name: '记一笔', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '记一笔', exact: true });
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [0, 0, width, 844]);
    assert.equal(await dialog.locator('input').count(), 0);
    await page.screenshot({ path: `artifacts/entry-direction-${width}.png` });
    await dialog.getByRole('button', { name: '支出', exact: true }).click();
    assert.deepEqual(await dialog.locator('.entry-category-grid>button>span:last-of-type').allTextContents(), expenseCategories);
    assert.equal(await dialog.locator('.entry-category-grid svg').count(), 37);
    const tones = await dialog.locator('.entry-category-grid .entry-category-icon').evaluateAll(icons => icons.map(icon => [...icon.classList].find(name => name.startsWith('category-tone-'))));
    const groups = tones.filter((tone, index) => index === 0 || tone !== tones[index - 1]);
    assert.equal(groups.length, new Set(tones).size, 'Each category group must be contiguous');
    assert.equal(await dialog.getByRole('button', { name: '餐饮', exact: true }).count(), 0);
    const iconColors = await dialog.locator('.entry-category-grid>button').evaluateAll(buttons => Object.fromEntries(buttons.map(button => {
      const icon = button.querySelector('.entry-category-icon');
      const style = getComputedStyle(icon);
      return [button.textContent.trim(), [style.color, style.backgroundColor]];
    })));
    for (const name of ['午餐', '晚餐', '蔬菜', '水果', '零食']) assert.deepEqual(iconColors[name], iconColors['早餐']);
    for (const name of ['旅行', '汽车', '快递']) assert.deepEqual(iconColors[name], iconColors['交通']);
    assert.notDeepEqual(iconColors['交通'], iconColors['早餐']);
    assert.equal(await dialog.locator('input').count(), 0);
    await page.screenshot({ path: `artifacts/entry-expense-categories-${width}.png` });
    await dialog.getByRole('button', { name: '快递', exact: true }).click();
    await dialog.getByLabel('金额（元）', { exact: true }).fill('35.60');
    await dialog.getByLabel('备注', { exact: true }).fill('测试备注');
    await dialog.getByRole('button', { name: '上一步' }).click();
    await dialog.getByRole('button', { name: '蔬菜', exact: true }).click();
    assert.deepEqual(await dialog.locator('.entry-selected-category .entry-category-icon').evaluate(icon => {
      const style = getComputedStyle(icon);
      return [style.color, style.backgroundColor];
    }), iconColors['蔬菜']);
    assert.equal(await dialog.getByLabel('金额（元）', { exact: true }).inputValue(), '35.60');
    assert.equal(await dialog.getByLabel('备注', { exact: true }).inputValue(), '测试备注');
    assert.equal(writes.length, 0, 'Navigating must never save');
    const amount = dialog.getByLabel('金额（元）', { exact: true });
    for (const invalid of ['0', '1000001', '12.345']) {
      await amount.fill(invalid);
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      assert.equal(writes.length, 0);
    }
    await amount.fill('35.60');
    await page.screenshot({ path: `artifacts/entry-fill-${width}.png` });
    await dialog.getByRole('button', { name: '更换类别' }).click();
    await dialog.getByRole('button', { name: '收入', exact: true }).click();
    assert.deepEqual(await dialog.locator('.entry-category-grid>button>span:last-of-type').allTextContents(), ['工资', '兼职', '理财', '债务', '礼金', '其他']);
    for (const name of ['工资', '兼职', '理财', '债务']) {
      assert.deepEqual(await dialog.getByRole('button', { name, exact: true }).locator('.entry-category-icon').evaluate(icon => {
        const style = getComputedStyle(icon);
        return [style.color, style.backgroundColor];
      }), iconColors['还贷'], 'Finance colors must match across income and expense');
    }
    assert.equal(await dialog.getByRole('button', { name: '还贷', exact: true }).count(), 0);
    await page.screenshot({ path: `artifacts/entry-income-categories-${width}.png` });
    await dialog.getByRole('button', { name: '兼职', exact: true }).click();
    assert.equal(await dialog.getByLabel('金额（元）', { exact: true }).inputValue(), '35.60');
    failNext = true;
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByLabel('备注', { exact: true }).inputValue(), '测试备注');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 2);
    assert.equal(writes[0].body.requestId, writes[1].body.requestId);
    assert.deepEqual(writes[1].body.payload, { amount: '35.60', title: '测试备注', date: today, category: '兼职', direction: 'income' });
    assert.equal(writes[1].body.confirmed, true);
    assert.equal(records.length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  records = [legacy];
  writes = [];
  await page.reload();
  await page.getByRole('button', { name: '修改旧分类账目', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '修改记录', exact: true });
  assert.equal(await edit.getByLabel('金额（元）', { exact: true }).inputValue(), '88');
  await edit.getByRole('button', { name: '更换类别' }).click();
  await edit.getByRole('button', { name: '餐饮', exact: true }).click();
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].body.revision, 3);
  assert.equal(writes[0].body.payload.category, '餐饮');
  for (const category of ['早餐', '午餐', '晚餐', '水果', '还贷']) {
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    if (await page.locator('.add-menu').isVisible()) await page.locator('.add-menu').getByRole('button', { name: '记一笔', exact: true }).click();
    await page.getByRole('button', { name: '支出', exact: true }).click();
    await page.getByRole('button', { name: category, exact: true }).click();
    await page.getByLabel('金额（元）', { exact: true }).fill('6.80');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).body.payload.category, category);
    assert.equal(writes.at(-1).body.payload.direction, 'expense');
  }
  await page.getByRole('button', { name: '支出分类统计', exact: true }).click();
  const chartColors = () => page.locator('.category-line').evaluateAll(rows => Object.fromEntries(rows.map(row => [
    row.querySelector('.category-name').textContent, getComputedStyle(row.querySelector('.category-symbol')).color,
  ])));
  const before = await chartColors();
  for (const category of ['早餐', '午餐', '晚餐', '水果']) assert.equal(before[category], before['餐饮']);
  records = records.map((record, index) => ({ ...record, payload: { ...record.payload, cents: (index + 1) * 9999 } }));
  await page.reload();
  await page.getByRole('button', { name: '支出分类统计', exact: true }).click();
  assert.deepEqual(await chartColors(), before, 'Category colors must not change when spending rank changes');
  records = [{ ...legacy, status: 'pending', payload: { ...legacy.payload, title: '待核对测试' } }];
  writes = [];
  await page.reload();
  await page.locator('.pending-row').filter({ hasText: '待核对测试' }).getByRole('button', { name: '核对', exact: true }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(writes[0].path, '/api/records/legacy/confirm');
  assert.equal(writes[0].body.revision, 3);
  assert.deepEqual(errors, []);
  console.log('PASS: fullscreen 320/390/1366, 37 grouped expense and 6 income categories, finance colors, meal/loan saves, validation, retry and legacy editing. Browser fixtures only.');
} finally {
  await browser.close();
}
