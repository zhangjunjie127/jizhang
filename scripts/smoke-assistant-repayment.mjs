import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const live = process.env.LIVE_AI_TEST === '1';
const width = Number(process.env.TEST_WIDTH || 390);
const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const directory = mkdtempSync(join(tmpdir(), 'assistant-repayment-'));
let child, browser, provider, token;
async function port() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const value = server.address().port;
  await new Promise(done => server.close(done));
  return value;
}
const backend = `http://127.0.0.1:${await port()}`;
async function api(path, body, expected = 200) {
  const response = await fetch(`${backend}/api${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result.error || { status: response.status }));
  return result;
}
try {
  let providerBase = process.env.CPA_BASE_URL, providerKey = process.env.CPA_API_KEY;
  if (live) assert.ok(providerBase && providerKey, 'Live test needs existing provider settings in environment');
  else {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      assert.ok(request.messages[0].content.includes('personalDebts'));
      const replied = request.messages.at(-1).role === 'tool';
      if (!replied) assert.ok(request.tools.some(tool => tool.function.name === 'propose_debt_repayment'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: replied ? { role: 'assistant', content: '还款草稿已准备好，请选择原欠条并确认。' }
        : { role: 'assistant', tool_calls: [{ id: randomUUID(), type: 'function', function: {
          name: 'propose_debt_repayment', arguments: JSON.stringify({ personName: '测试张三', amount: 500, date }),
        } }] } }] }));
    });
    await new Promise(done => provider.listen(0, '127.0.0.1', done));
    providerBase = `http://127.0.0.1:${provider.address().port}/v1`;
    providerKey = 'fixture-only';
  }
  child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: new URL(backend).port, DATA_DIR: directory, INVITE_CODE: 'assistant-test',
      CPA_BASE_URL: providerBase, CPA_API_KEY: providerKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timer); done(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  token = (await api('/register', { username: 'assistant-test', password: 'test-password-123', name: '测试', birthday: '2000-01-01', invite: 'assistant-test' })).token;
  const original = await api('/debts', { personName: '测试张三', direction: 'receivable', amount: 1000, date: '2026-01-01', dueDate: '2026-12-31', note: '第一张欠条', requestId: randomUUID() });
  const second = await api('/debts', { personName: '测试张三', direction: 'receivable', amount: 800, date: '2026-01-02', dueDate: '2026-12-31', note: '第二张欠条', requestId: randomUUID() });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width, height: width === 320 ? 740 : 844 } });
  page.setDefaultTimeout(live ? 100000 : 10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}`, timeout: 180000 });
    await route.fulfill({ response });
  });
  await page.addInitScript(value => localStorage.setItem('zaizai-token', value), token);
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByLabel('发送给助手的消息').fill(`测试张三昨天还给我500元，帮我记录还款。`);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: /条记录等你核对/ }).waitFor();
  const pending = (await api('/state')).records;
  const draft = pending.find(record => record.kind === 'debt_repayment');
  assert.ok(draft, 'Assistant must propose a repayment, not ordinary income');
  assert.equal(draft.payload.date, date);
  assert.equal(draft.payload.cents, 50000);
  assert.equal(pending.filter(record => record.kind === 'expense').length, 0);
  assert.equal((await api('/debts')).payments.length, 0, 'Chat must never move money before confirmation');
  await api(`/records/${draft.id}/confirm`, {}, 409);
  await api('/records/confirm-batch', { items: [{ id: draft.id, revision: 0 }] }, 409);
  await page.getByRole('button', { name: /条记录等你核对/ }).click();
  await page.getByRole('button', { name: '核对', exact: true }).click();
  await page.getByLabel('还款原欠条').waitFor();
  assert.equal(await page.getByLabel('还款原欠条').inputValue(), '', 'Multiple bills require explicit choice');
  assert.equal(await page.getByRole('button', { name: '确认还款并记收入', exact: true }).isDisabled(), true);
  await page.getByLabel('还款原欠条').selectOption(original.billId);
  mkdirSync('artifacts', { recursive: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `artifacts/assistant-repayment-${live ? 'live' : 'fixture'}-${width}.png` });
  await page.getByRole('button', { name: '确认还款并记收入', exact: true }).click();
  await page.getByRole('dialog', { name: '借款详情', exact: true }).waitFor();
  await page.locator('.debt-balance strong').waitFor();
  assert.equal(await page.locator('.debt-balance strong').textContent(), '500.00');
  assert.ok((await page.locator('.debt-facts').textContent()).includes(`最近还款日${date}`));
  let state = await api('/state');
  assert.equal(state.records.filter(record => record.source === 'debt-repayment').length, 1);
  assert.equal(state.records.find(record => record.id === draft.id).status, 'confirmed');
  const debts = await api('/debts');
  assert.equal(debts.bills.find(bill => bill.id === second.billId).balanceCents, 80000);
  assert.equal(debts.bills.find(bill => bill.id === original.billId).due_date, '2026-12-31');
  const body = { billId: original.billId, billRevision: 0, revision: 0, amount: 500, date, note: draft.payload.note };
  await api(`/records/${draft.id}/confirm-debt`, body);
  await api(`/records/${draft.id}/confirm-debt`, { ...body, billId: second.billId }, 409);
  state = await api('/state');
  assert.equal(state.records.filter(record => record.source === 'debt-repayment').length, 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '记账', exact: true }).click();
  assert.equal(await page.locator('.ledger-row').filter({ hasText: '测试张三还款' }).locator('.ledger-amount').textContent(), '+500.00');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${live ? 'REAL configured AI' : 'fixture AI'} -> browser chat -> pending repayment -> user bill selection -> atomic confirmation -> updated balance/date/income. Isolated database; no live account writes.`);
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (provider) await new Promise(done => provider.close(done));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') && !resolve(directory).startsWith(resolve(tmpdir()) + '/')) throw new Error('Unsafe cleanup path');
  rmSync(directory, { recursive: true, force: true });
}
