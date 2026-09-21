import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
let token;
async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, `HTTP ${response.status}: ${data.error || ''}`);
  return data;
}
const account = await api('/register', { username: `receipt-ui-${Date.now()}`, password: 'ReceiptUiTest917!', name: '小票测试', birthday: '2000-01-01', invite: process.env.INVITE_CODE });
token = account.token;
await api('/profile', { proactive: false }, 'PATCH');
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const paper = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 2 });
  await paper.setContent(`<html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:white;font:28px "Microsoft YaHei",sans-serif;color:black}article{width:660px;padding:40px}h1{font-size:42px;text-align:center;margin:0 0 14px}p{margin:16px 0}table{width:100%;border-collapse:collapse;font-size:26px}td,th{text-align:left;padding:20px 0;border-bottom:1px solid #555}td:last-child,th:last-child{text-align:right}.total{font-size:36px;font-weight:bold;border-top:2px solid black;padding-top:20px}</style><article><h1>测试超市</h1><p style="text-align:center">购物小票 · 非真实交易</p><p>日期：${day}</p><p>币种：人民币 CNY</p><table><tr><th>商品</th><th>数量</th><th>单价</th><th>小计</th></tr><tr><td>纯牛奶</td><td>2盒</td><td>5.00</td><td>10.00</td></tr><tr><td>抽纸</td><td>1包</td><td>13.50</td><td>13.50</td></tr></table><p>商品合计：23.50</p><p>整单优惠：-2.00</p><p class="total">实付：21.50 元</p><p>共 2 种商品，3 件</p></article></html>`);
  await paper.locator('article').screenshot({ path: 'artifacts/receipt-test-input.png' });
  await paper.close();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(token => localStorage.setItem('zaizai-token', token), token);
  await page.goto(base);
  await page.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByRole('button', { name: '拍照识别小票' }).click();
  await page.getByLabel('上传小票图片').setInputFiles('artifacts/receipt-test-input.png');
  await page.getByLabel('实付金额（元）', { exact: true }).waitFor({ timeout: 100000 });
  assert.equal((await api('/state', null, 'GET')).records.length, 0, 'Recognition must not write a record');
  assert.equal(Number(await page.getByLabel('实付金额（元）', { exact: true }).inputValue()), 21.5);
  assert.equal(await page.locator('.receipt-item').count(), 2);
  assert.equal(await page.getByLabel('购买日期', { exact: true }).inputValue(), day);
  await page.getByRole('button', { name: /编辑商品.*牛奶/ }).click();
  assert.equal(Number(await page.getByLabel('数量', { exact: true }).inputValue()), 2);
  await page.getByLabel('小计（元）', { exact: true }).fill('11');
  assert.equal(await page.getByRole('button', { name: '确认入账', exact: true }).isDisabled(), true);
  await page.getByLabel('小计（元）', { exact: true }).fill('10');
  await page.getByRole('button', { name: /编辑商品.*牛奶/ }).click();
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: `artifacts/receipt-review-${width}.png` });
  }
  await page.getByRole('checkbox', { name: /已核对商品/ }).check();
  await page.getByRole('button', { name: '确认入账', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const saved = await api('/state', null, 'GET');
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].payload.cents, 2150);
  assert.equal(saved.records[0].payload.receipt.items.length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
  await page.getByRole('button', { name: `修改${saved.records[0].payload.title}`, exact: true }).click();
  await page.getByRole('dialog', { name: '小票详情', exact: true }).waitFor();
  assert.equal(await page.locator('.receipt-item').count(), 2);
  await page.screenshot({ path: 'artifacts/receipt-saved-mobile.png' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: `修改${saved.records[0].payload.title}`, exact: true }).click();
  assert.equal(await page.locator('.receipt-item').count(), 2);
  await page.getByRole('button', { name: '修改小票', exact: true }).click();
  await page.getByLabel('账目名称', { exact: true }).fill('修改后的小票');
  await page.getByRole('checkbox', { name: /已核对商品/ }).check();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const edited = (await api('/state', null, 'GET')).records[0];
  assert.equal(edited.id, saved.records[0].id);
  assert.equal(edited.payload.title, '修改后的小票');
  assert.equal(edited.payload.receipt.items.length, 2);
  await page.getByRole('button', { name: '修改修改后的小票', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByRole('button', { name: '拍照识别小票' }).click();
  await page.getByLabel('上传小票图片').setInputFiles('artifacts/receipt-test-input.png');
  await page.getByRole('alert').filter({ hasText: '这张小票已入账' }).waitFor({ timeout: 100000 });
  assert.equal((await api('/state', null, 'GET')).records.length, 1);
  assert.deepEqual(errors, []);
  const report = { passed: true, realImageModel: true, confirmationRequired: true, singleExpense: true, itemDetailsAfterReload: true, duplicateRejected: true, widths: [320, 390, 1366], errors };
  writeFileSync('artifacts/receipt-ui-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
