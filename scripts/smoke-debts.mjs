import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'zaizai-debt-ui-'));
const probe = net.createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const backend = `http://127.0.0.1:${port}`;
let child, browser, token;
async function api(path, body) {
  const response = await fetch(`${backend}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
try {
  child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory, CPA_API_KEY: '', CPA_BASE_URL: '', INVITE_CODE: 'debt-ui' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test backend startup timeout')), 10000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timeout); done(); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  token = (await api('/register', { username: 'debt-ui', password: 'debt-test-password', name: '测试', birthday: '2000-01-01', invite: 'debt-ui' })).token;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.addInitScript(value => localStorage.setItem('zaizai-token', value), token);
  mkdirSync('artifacts', { recursive: true });
  for (const width of [320, 390, 430]) {
    const name = `张三${width}`;
    await page.setViewportSize({ width, height: 844 });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    for (const view of ['明细', '月账单', '年账单', '债务']) {
      await page.getByRole('tab', { name: view, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Toolbar fits ${width}`);
      const controls = await page.locator('.ledger-toolbar button').evaluateAll(buttons => buttons.map(button => {
        const { left, right } = button.getBoundingClientRect();
        return { left, right };
      }));
      for (let i = 1; i < controls.length; i++) assert.ok(controls[i - 1].right <= controls[i].left, 'Toolbar controls must not overlap');
    }
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByRole('tab', { name: '债务', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '新增借款', exact: true }).waitFor();
    async function create(amount, note, payable = false) {
      await page.getByRole('button', { name: '新增借款', exact: true }).click();
      if (payable) await page.getByRole('button', { name: '我借入', exact: true }).click();
      await page.getByLabel('对方姓名', { exact: true }).fill(name);
      await page.getByLabel('借款金额（元）', { exact: true }).fill(amount);
      await page.getByLabel('借款日期', { exact: true }).fill('2026-01-01');
      await page.getByLabel('约定还款日（选填）', { exact: true }).fill('2026-12-31');
      await page.getByLabel('备注', { exact: true }).fill(note);
      await page.getByRole('button', { name: '确认保存借款', exact: true }).click();
      await page.locator('.debt-balance strong').waitFor();
    }
    await create('1000', '第一笔周转');
    await page.getByRole('button', { name: '返回债务上一级' }).click();
    await create('500', '第二笔借款');
    await page.getByRole('button', { name: '返回债务上一级' }).click();
    assert.equal(await page.locator('.debt-bill-row').count(), 2);
    await page.locator('.debt-bill-row').filter({ hasText: '第一笔周转' }).click();
    await page.getByRole('button', { name: '登记还款', exact: true }).click();
    await page.getByLabel('本次还款（元）', { exact: true }).fill('1001');
    await page.getByRole('button', { name: '确认还款并记收入', exact: true }).click();
    assert.equal((await api('/debts')).payments.filter(payment => !payment.voided_at).length, width === 320 ? 0 : width === 390 ? 1 : 2);
    await page.getByLabel('本次还款（元）', { exact: true }).fill('200');
    await page.getByLabel('实际还款日期', { exact: true }).fill('2026-01-02');
    await page.getByLabel('备注', { exact: true }).fill('收到转账');
    await page.getByRole('button', { name: '确认还款并记收入', exact: true }).click();
    await page.locator('.debt-balance strong').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.debt-balance strong').textContent(), '800.00');
    assert.equal(await page.locator('.debt-event').count(), 2);
    assert.match(await page.locator('.debt-facts').textContent(), /约定还款日2026-12-31/);
    assert.match(await page.locator('.debt-history').textContent(), /提前还款/);
    assert.match(await page.locator('.debt-history').textContent(), /已记收入/);
    await page.screenshot({ path: `artifacts/debt-bill-${width}.png` });
    await page.getByRole('tab', { name: '年账单', exact: true }).click();
    await page.getByRole('button', { name: '查看2026年各月账单', exact: true }).click();
    await page.getByRole('button', { name: '查看2026-01月明细', exact: true }).click();
    const incomeRow = page.locator('.ledger-row').filter({ hasText: `${name}还款` });
    await incomeRow.waitFor();
    assert.equal(await incomeRow.locator('.ledger-amount').textContent(), '+200.00');
    await incomeRow.locator('.ledger-entry').click();
    await page.getByRole('dialog', { name: '借款详情', exact: true }).waitFor();
    await page.locator('.debt-balance strong').waitFor();
    await page.getByRole('button', { name: '上一步' }).click();
    assert.equal(await page.locator('.debt-bill-row').count(), 2);
    assert.equal(await page.locator('.debt-totals>div').first().locator('strong').textContent(), '1,300.00');
    await page.screenshot({ path: `artifacts/debt-person-${width}.png` });
    await create('100', '我向张三借的', true);
    await page.getByRole('button', { name: '上一步' }).click();
    assert.equal(await page.locator('.debt-totals>div').first().locator('strong').textContent(), '1,300.00');
    assert.equal(await page.locator('.debt-totals>div').nth(1).locator('strong').textContent(), '100.00');
    await page.locator('.debt-bill-row').filter({ hasText: '第一笔周转' }).click();
    await page.getByRole('button', { name: '登记还款', exact: true }).click();
    await page.getByLabel('本次还款（元）', { exact: true }).fill('800');
    await page.getByLabel('实际还款日期', { exact: true }).fill('2026-01-03');
    await page.getByRole('button', { name: '确认还款并记收入', exact: true }).click();
    await page.getByRole('dialog', { name: '借款详情', exact: true }).waitFor();
    assert.equal(await page.locator('.debt-badge').textContent(), '已结清');
    assert.equal(await page.locator('.debt-balance strong').textContent(), '0.00');
    await page.locator('.debt-event').filter({ hasText: '800.00' }).last().getByRole('button').click();
    await page.getByLabel('撤销原因', { exact: true }).fill('误录，实际尚未收到');
    await page.getByRole('button', { name: '确认撤销', exact: true }).click();
    await page.getByRole('dialog', { name: '借款详情', exact: true }).waitFor();
    assert.equal(await page.locator('.debt-balance strong').textContent(), '800.00');
    assert.equal(await page.locator('.debt-event.is-void').count(), 1);
    assert.ok((await page.locator('.debt-facts').textContent()).includes('最近还款日2026-01-02'), 'Voided payments must not become the latest repayment');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.locator('.ledger-row').filter({ hasText: `${name}还款` }).count(), 1);
    assert.equal(await page.locator('.ledger-row').filter({ hasText: `${name}还款` }).locator('.ledger-amount').textContent(), '+200.00');
    await page.reload();
    await page.getByRole('tab', { name: '债务', exact: true }).click();
    await page.getByLabel('搜索往来人', { exact: true }).fill(name);
    await page.getByRole('button', { name: `查看${name}的账单`, exact: true }).waitFor();
    assert.equal(await page.locator('.debt-person-row .debt-amount').textContent(), '1,300.00');
    await page.screenshot({ path: `artifacts/debt-people-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const records = (await api('/state')).records;
    assert.equal(records.length, width === 320 ? 1 : width === 390 ? 2 : 3);
    assert.ok(records.every(record => record.payload.direction === 'income' && record.payload.cents === 20000), 'Only active received repayments count as income');
  }
  const incomeBill = await api('/debts', { personName: '收入入口测试', direction: 'receivable', amount: '1000', date: '2026-01-01', dueDate: '2026-12-31', requestId: randomUUID() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('button', { name: '收入', exact: true }).click();
  await page.getByRole('button', { name: '债务', exact: true }).click();
  await page.getByRole('dialog', { name: '收回欠款', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看收入入口测试的账单', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '我欠别人', exact: true }).count(), 0);
  await page.locator('.debt-bill-row').click();
  await page.getByRole('button', { name: '登记还款', exact: true }).click();
  await page.getByLabel('本次还款（元）', { exact: true }).fill('500');
  const actualDate = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await page.getByLabel('实际还款日期', { exact: true }).fill(actualDate);
  await page.getByRole('button', { name: '确认还款并记收入', exact: true }).click();
  await page.getByRole('dialog', { name: '借款详情', exact: true }).waitFor();
  assert.equal(await page.locator('.debt-balance strong').textContent(), '500.00');
  assert.match(await page.locator('.debt-facts').textContent(), /约定还款日2026-12-31/);
  assert.ok((await page.locator('.debt-facts').textContent()).includes(`最近还款日${actualDate}`));
  assert.equal(await page.locator('.debt-history .debt-event').last().locator('time').textContent(), `实际还款日期 ${actualDate}`);
  await page.locator('.debt-history').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/blue-debt-income-390.png' });
  await page.getByRole('button', { name: '上一步' }).click();
  assert.match(await page.locator('.debt-bill-numbers').textContent(), /原借款 1,000.00.*剩余 500.00/);
  assert.equal(await page.locator('.debt-totals>div').first().locator('strong').textContent(), '500.00');
  assert.ok((await page.locator('.debt-bill-row').textContent()).includes(`最近还款 ${actualDate}`));
  await page.screenshot({ path: 'artifacts/debt-updated-list-390.png' });
  await page.getByRole('button', { name: '上一步' }).click();
  assert.equal(await page.getByRole('button', { name: '查看收入入口测试的账单', exact: true }).locator('.debt-row-total>.debt-amount').textContent(), '500.00');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const incomeRecord = page.locator('.ledger-row').filter({ hasText: '收入入口测试还款' });
  await incomeRecord.waitFor();
  assert.equal(await incomeRecord.locator('.ledger-amount').textContent(), '+500.00');
  assert.match(await incomeRecord.locator('.row-main small').textContent(), /债务.*收回欠款/);
  const updatedDebts = await api('/debts');
  assert.equal(updatedDebts.bills.find(bill => bill.id === incomeBill.billId).balanceCents, 50000);
  assert.equal(updatedDebts.payments.filter(payment => payment.bill_id === incomeBill.billId).length, 1);
  assert.equal(updatedDebts.payments.find(payment => payment.bill_id === incomeBill.billId).date, actualDate);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?preview=phone`);
  await page.getByRole('tab', { name: '债务', exact: true }).click();
  await page.getByRole('button', { name: '新增借款', exact: true }).click();
  await page.getByLabel('对方姓名', { exact: true }).click();
  await page.getByRole('region', { name: '文字键盘' }).waitFor();
  await page.getByLabel('对方姓名', { exact: true }).fill('未保存测试');
  const input = page.getByLabel('借款金额（元）', { exact: true });
  await input.click();
  const keypad = page.getByRole('region', { name: '数字键盘' });
  await keypad.getByRole('button', { name: '2', exact: true }).click();
  assert.equal(await input.inputValue(), '2');
  const inputBox = await input.boundingBox();
  const keypadBox = await keypad.boundingBox();
  assert.ok(inputBox.y + inputBox.height <= keypadBox.y);
  await page.screenshot({ path: 'artifacts/debt-create-preview-320.png' });
  await page.getByRole('button', { name: '返回债务上一级', exact: true }).click();
  assert.equal(await page.locator('.preview-keyboard').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real isolated backend; inline debt tab, creation and repayment without dialogs; modal income review retained; per-person totals, separate loans, overpayment guard, settlement/undo, persistence, preview keyboards and 320/390/430 layouts.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') && !resolve(directory).startsWith(resolve(tmpdir()) + '/')) throw new Error('Unsafe cleanup directory');
  rmSync(directory, { recursive: true, force: true });
}
