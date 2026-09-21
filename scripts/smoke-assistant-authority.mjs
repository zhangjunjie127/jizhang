import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const live = process.env.LIVE_AI_TEST === '1';
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const width = Number(process.env.TEST_WIDTH || 390);
const directory = mkdtempSync(join(tmpdir(), 'assistant-authority-'));
const probe = createServer();
await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const base = `http://127.0.0.1:${port}`;
let provider, child, browser, token, target;
async function api(path, body, method = body ? 'POST' : 'GET', expected = 200) {
  const response = await fetch(`${base}/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, result.error || path);
  return result;
}
try {
  let providerBase = process.env.CPA_BASE_URL, providerKey = process.env.CPA_API_KEY;
  if (live) assert.ok(providerBase && providerKey, 'Live test requires configured provider environment');
  else {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      const text = request.messages.findLast(m => m.role === 'user').content;
      const tool = request.messages.at(-1).role === 'tool';
      let name = 'propose_record', args = { kind: 'expense', title: '午餐', category: '午餐', amount: 28, direction: 'expense', date };
      if (text.includes('改成18')) { name = 'prepare_app_action'; args = { operation: 'update_record', id: target.id, revision: target.revision, data: { amount: 18 } }; }
      if (text.includes('还给我')) { name = 'propose_debt_repayment'; args = { personName: '测试张三', amount: 500, date }; }
      if (text.includes('删除')) { name = 'prepare_app_action'; args = { operation: 'trash_record', id: target.id, revision: target.revision }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: tool ? { role: 'assistant', content: '已准备操作，请核对后确认。' } :
        { role: 'assistant', tool_calls: [{ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
    });
    await new Promise(done => provider.listen(0, '127.0.0.1', done));
    providerBase = `http://127.0.0.1:${provider.address().port}/v1`;
    providerKey = 'fixture-only';
  }
  child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    DATA_DIR: directory, INVITE_CODE: 'authority-test', CPA_BASE_URL: providerBase, CPA_API_KEY: providerKey },
    stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
    child.stdout.on('data', data => { if (data.toString().includes('Zaizai server:')) { clearTimeout(timer); done(); } });
    child.once('error', reject);
  });
  token = (await api('/register', { username: 'authority-test', password: 'test-password-123', name: '测试',
    birthday: '2000-01-01', invite: 'authority-test' })).token;
  await api('/profile', { proactive: false }, 'PATCH');
  const debt = await api('/debts', { personName: '测试张三', direction: 'receivable', amount: 1000, date: '2026-01-01',
    dueDate: '2026-12-31', requestId: randomUUID(), note: '测试原欠条' });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(live ? 120000 : 15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${base}${url.pathname}${url.search}`, timeout: 180000 });
    await route.fulfill({ response });
  });
  await page.addInitScript(value => localStorage.setItem('zaizai-token', value), token);
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: '助手', exact: true }).click();
  async function send(text) {
    await page.getByLabel('发送给助手的消息').fill(text);
    const response = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST', { timeout: 180000 });
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  }
  if (process.env.VOICE_ONLY !== '1') {
  await send('今天午餐花了28元，支出，分类午餐，请帮我记账。');
  await page.getByRole('region', { name: '助手操作确认' }).waitFor();
  target = (await api('/state')).records.find(r => r.kind === 'expense');
  assert.equal(target.status, 'pending');
  await send('确认');
  await page.locator('.assistant-approval').waitFor({ state: 'hidden' });
  target = (await api('/state')).records.find(r => r.id === target.id);
  assert.equal(target.status, 'confirmed');
  assert.equal(target.payload.amount, 28);
  await send('把刚才确认的午餐支出改成18元，其他不变。');
  await page.getByRole('region', { name: '助手操作确认' }).waitFor();
  assert.equal((await api('/state')).records.find(r => r.id === target.id).payload.amount, 28);
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await page.locator('.assistant-approval').waitFor({ state: 'hidden' });
  target = (await api('/state')).records.find(r => r.id === target.id);
  assert.equal(target.payload.amount, 18);
  await send('测试张三今天还给我500元，请记录到原欠条并记收入。');
  await page.getByRole('region', { name: '助手操作确认' }).waitFor();
  assert.equal((await api('/debts')).payments.length, 0);
  assert.match(await page.locator('.assistant-approval').innerText(), /500.00元/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: `artifacts/assistant-authority-${live ? 'live' : 'fixture'}-${width}.png` });
  await send('确认执行');
  await page.locator('.assistant-approval').waitFor({ state: 'hidden' });
  const updated = await api('/debts');
  assert.equal(updated.bills.find(b => b.id === debt.billId).balanceCents, 50000);
  assert.equal(updated.bills[0].due_date, '2026-12-31');
  assert.equal(updated.payments[0].date, date);
  assert.equal((await api('/state')).records.filter(r => r.source === 'debt-repayment').length, 1);
  await send('确认');
  assert.equal((await api('/debts')).payments.length, 1);
  await send('删除刚才18元的午餐支出。');
  await page.getByRole('region', { name: '助手操作确认' }).waitFor();
  await send('取消');
  await page.locator('.assistant-approval').waitFor({ state: 'hidden' });
  assert.ok((await api('/state')).records.find(r => r.id === target.id));
  assert.deepEqual(errors, []);
  console.log(`PASS ${live ? 'REAL AI' : 'fixture'} ${width}px: pending -> text confirm -> reviewed edit -> button confirm -> debt repayment -> unchanged due date + income -> duplicate blocked -> cancellation. Isolated data only.`);
  } else {
    target = (await api('/records', { kind: 'expense', confirmed: true, payload: {
      title: '午餐', category: '午餐', amount: 18, date, direction: 'expense',
    } }, 'POST', 201)).records.find(r => r.kind === 'expense');
  }
  if (live && process.env.LIVE_VOICE_TEST === '1') {
    const sample = await new Promise((done, reject) => {
      const socket = new WebSocket(`${providerBase.replace(/^http/, 'ws')}/realtime?model=gpt-realtime-2.1`,
        { headers: { Authorization: `Bearer ${providerKey}` } });
      const chunks = [];
      const timer = setTimeout(() => finish(new Error('Synthetic confirmation generation timeout')), 45000);
      function finish(error) { clearTimeout(timer); socket.terminate(); error ? reject(error) : done(Buffer.concat(chunks)); }
      socket.on('error', finish);
      socket.on('message', raw => {
        const event = JSON.parse(raw);
        if (event.type === 'session.created') socket.send(JSON.stringify({ type: 'response.create',
          response: { instructions: '请用清晰的标准普通话，完整说一次“确认执行”。只说这四个字，不要解释，不要重复。', input: [], output_modalities: ['audio'] } }));
        if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) chunks.push(Buffer.from(event.delta, 'base64'));
        if (event.type === 'error') finish(new Error(event.error?.message));
        if (event.type === 'response.done') finish();
      });
    });
    assert.ok(sample.length);
    await new Promise((done, reject) => {
      const socket = new WebSocket(base.replace(/^http/, 'ws') + '/voice');
      let feeder, feeding = false, summarySeen = false, transcript = '', output = '';
      const timer = setTimeout(() => finish(new Error(`Voice approval timeout: summaryReady=${summarySeen}; input=${transcript}; output=${output}`)), 120000);
      function finish(error) { clearTimeout(timer); clearInterval(feeder); socket.terminate(); error ? reject(error) : done(); }
      socket.on('error', finish);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
      socket.on('message', async raw => {
        try {
          const event = JSON.parse(raw);
          if (event.type === 'app.ready') socket.send(JSON.stringify({ type: 'app.text', text: '把今天午餐的18元改成19元，其他不变，请核对。' }));
          if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(event.type)) output += event.transcript;
          if (event.type === 'app.approval_playback') {
            summarySeen = true;
            socket.send(JSON.stringify({ type: 'app.approval_heard', id: event.id }));
          }
          if (event.type === 'app.approval_ready' && !feeding) {
            feeding = true;
            const silence = Buffer.alloc(24000);
            const audio = Buffer.concat([silence, sample, silence, silence]);
            let offset = 0;
            feeder = setInterval(() => {
              if (offset >= audio.length) { clearInterval(feeder); return; }
              const chunk = audio.subarray(offset, offset + 4800); offset += chunk.length;
              socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
            }, 100);
          }
          if (event.type === 'conversation.item.input_audio_transcription.completed') transcript += `${event.transcript};`;
          if (event.type === 'app.message' && event.message.role === 'event' && event.message.text.startsWith('已执行')) {
            const state = await api('/state');
            assert.equal(state.records.find(r => r.id === target.id).payload.amount, 19);
            finish();
          }
          if (event.type === 'app.error' || event.type === 'error') finish(new Error(event.message || event.error?.message));
        } catch (error) { finish(error); }
      });
    });
    console.log('PASS REAL realtime model: proposed reviewed edit -> full spoken summary -> synthetic confirmation audio -> real transcription -> authorized mutation. Audio playback acknowledgment simulated; no human microphone tested.');
  }
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (provider) await new Promise(done => provider.close(done));
  const parent = resolve(tmpdir());
  if (!resolve(directory).startsWith(parent + '\\') && !resolve(directory).startsWith(parent + '/')) throw new Error('Unsafe cleanup path');
  rmSync(directory, { recursive: true, force: true });
}
