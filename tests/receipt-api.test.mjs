import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

test('receipt OCR is authenticated, image-based, read-only until one explicit idempotent save', { timeout: 25000 }, async () => {
  const raw = {
    isReceipt: true, currency: 'CNY', merchant: '接口测试超市', date: '2026-09-17', total: '21.50',
    adjustmentAmount: '-2', adjustmentLabel: '整单优惠', warnings: [],
    items: [{ name: '牛奶', quantity: 2, unit: '盒', amount: '10', category: '餐饮' }, { name: '纸巾', quantity: 1, unit: '包', amount: '13.50', category: '购物' }],
  };
  let modelCalls = 0, input;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks));
    modelCalls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const data = mkdtempSync(join(tmpdir(), 'zaizai-receipt-'));
  const child = spawn(process.execPath, ['server/index.mjs'], { env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: data,
    CPA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, CPA_API_KEY: 'test-fixture', INVITE_CODE: 'receipt-test',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let token;
  const api = async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.on('data', data => { if (data.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); } });
      child.on('error', reject);
    });
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yUAAAAAASUVORK5CYII=';
    assert.equal((await api('/receipts/recognize', { image })).status, 401);
    token = (await api('/register', { username: 'receipt-test', password: 'receipt-test-pass', name: '测试', birthday: '2000-01-01', invite: 'receipt-test' })).data.token;
    await api('/profile', { proactive: false }, 'PATCH');
    assert.equal((await api('/receipts/recognize', { image: 'data:image/jpeg;base64,aGVsbG8=' })).status, 400);
    const scan = await api('/receipts/recognize', { image });
    assert.equal(scan.status, 200);
    assert.equal(input.messages[1].content[1].image_url.url, image);
    assert.equal(input.tools, undefined);
    assert.equal((await api('/state', null, 'GET')).data.records.length, 0);
    const payload = scan.data.payload;
    assert.equal((await api('/records', { kind: 'expense', payload: { ...payload, amount: 20 }, confirmed: true })).status, 400);
    const body = { kind: 'expense', payload, confirmed: true, requestId: randomUUID() };
    const saved = await api('/records', body);
    assert.equal(saved.status, 201);
    assert.equal(saved.data.records.length, 1);
    assert.equal(saved.data.records[0].payload.receipt.items.length, 2);
    assert.equal((await api('/records', body)).status, 200);
    assert.equal((await api('/records', { ...body, requestId: randomUUID() })).status, 409);
    assert.equal((await api('/receipts/recognize', { image })).status, 409);
    assert.equal(modelCalls, 1);
    const draft = await api('/records', { kind: 'expense', payload });
    assert.equal((await api(`/records/${draft.data.proposed.id}/confirm`, {})).status, 409);
    const reloaded = (await api('/state', null, 'GET')).data.records.find(r => r.status === 'confirmed');
    assert.equal(reloaded.payload.cents, 2150);
    const id = reloaded.id;
    await api(`/records/${id}`, null, 'DELETE');
    const replacement = await api('/records', { ...body, requestId: randomUUID() });
    assert.equal(replacement.status, 201);
    assert.equal((await api(`/records/${id}/restore`, {})).status, 409);
    const csv = await fetch(`http://127.0.0.1:${port}/api/ledger/export`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.text());
    assert.equal(csv.trim().split('\r\n').length, 2, 'Export contains a single receipt transaction');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
    await new Promise(resolve => upstream.close(resolve));
    assert.ok(resolve(data).startsWith(resolve(tmpdir()) + '\\zaizai-receipt-'));
    rmSync(data, { recursive: true, force: true });
  }
});
