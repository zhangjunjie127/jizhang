import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ageOn, validateRecord, passwordHash, verifyPassword } from '../server/domain.mjs';

let processServer, base, user, other;
const data = mkdtempSync(join(tmpdir(), 'zaizai-test-'));
async function api(path, { token, body, method = 'GET' } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  processServer = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, INVITE_CODE: 'test-invite', CPA_API_KEY: '', CPA_BASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    processServer.stdout.on('data', chunk => {
      if (chunk.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); }
    });
    processServer.on('error', reject);
  });
  user = (await api('/register', { method: 'POST', body: { username: 'tester1', password: 'test-password-123', name: 'Test', birthday: '2000-01-01', invite: 'test-invite' } })).data;
  other = (await api('/register', { method: 'POST', body: { username: 'tester2', password: 'test-password-123', name: 'Other', birthday: '2015-01-01', invite: 'test-invite' } })).data;
});
after(async () => {
  const exited = new Promise(resolve => processServer.once('exit', resolve));
  processServer.kill();
  await exited;
  rmSync(data, { recursive: true, force: true });
});

test('money is validated and converted to integer cents', () => {
  assert.equal(validateRecord('expense', { amount: '12.30' }).cents, 1230);
  assert.throws(() => validateRecord('expense', { amount: '12.301' }));
  assert.throws(() => validateRecord('expense', { amount: -1 }));
  assert.throws(() => validateRecord('weight', { kg: 'oops' }));
  assert.throws(() => validateRecord('task', { title: 'task', date: '2026-02-30' }));
});
test('age and password boundaries', () => {
  assert.equal(ageOn('2008-09-17', new Date('2026-09-16T00:00:00Z')), 17);
  assert.equal(ageOn('2008-09-16', new Date('2026-09-16T00:00:00Z')), 18);
  assert.throws(() => ageOn('2026-02-31'));
  const stored = passwordHash('correct-password');
  assert.equal(verifyPassword('correct-password', stored), true);
  assert.equal(verifyPassword('wrong-password', stored), false);
});
test('registration requires invite; account data never exposes password', async () => {
  assert.ok(user.token);
  assert.equal(user.user.password, undefined);
  assert.equal((await api('/state')).status, 401);
  const result = await api('/register', { method: 'POST', body: { username: 'badinvite', invite: 'wrong' } });
  assert.equal(result.status, 403);
});
test('proactive messages appear in the same timeline with an account-scoped marker', async () => {
  const db = new DatabaseSync(join(data, 'app.sqlite'));
  const id = randomUUID();
  const created = new Date().toISOString();
  try {
    db.prepare('INSERT INTO messages (id,user_id,role,text,created) VALUES (?,?,?,?,?)')
      .run(id, user.user.id, 'assistant', '测试主动询问', created);
    db.prepare('INSERT INTO checkins (id,user_id,topic,status,created,message_id) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), user.user.id, 'test-topic', 'sent', created, id);
    const own = await api('/state', { token: user.token });
    assert.equal(own.data.messages.find(item => item.id === id).proactive, 1);
    const unrelated = await api('/state', { token: other.token });
    assert.equal(unrelated.data.messages.some(item => item.id === id), false);
  } finally {
    db.prepare('DELETE FROM checkins WHERE message_id=?').run(id);
    db.prepare('DELETE FROM messages WHERE id=?').run(id);
    db.close();
  }
});
test('minor cannot enable romance; adult can explicitly opt in', async () => {
  assert.equal((await api('/profile', { token: other.token, method: 'PATCH', body: { relationship: 'romance' } })).status, 403);
  const result = await api('/profile', { token: user.token, method: 'PATCH', body: { relationship: 'romance' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.user.relationship, 'romance');
});
test('records remain pending until explicit confirmation and confirmation is idempotent', async () => {
  const proposed = await api('/records', { token: user.token, method: 'POST', body: { kind: 'expense', payload: { amount: '28.10', category: '餐饮', title: '午饭' } } });
  const id = proposed.data.proposed.id;
  assert.equal(proposed.data.records[0].status, 'pending');
  assert.equal((await api(`/records/${id}/confirm`, { token: other.token, method: 'POST', body: {} })).status, 404);
  const confirmed = await api(`/records/${id}/confirm`, { token: user.token, method: 'POST', body: { payload: { amount: '28.20', title: '午饭', category: '餐饮' } } });
  assert.equal(confirmed.data.records.find(r => r.id === id).payload.cents, 2820);
  const repeated = await api(`/records/${id}/confirm`, { token: user.token, method: 'POST', body: {} });
  assert.equal(repeated.data.records.filter(r => r.id === id).length, 1);
  assert.equal(repeated.data.records.find(r => r.id === id).status, 'confirmed');
});
test('persona changes preserve records and are added to shared history', async () => {
  const result = await api('/profile', { token: user.token, method: 'PATCH', body: { persona: 'blunt' } });
  assert.equal(result.data.user.persona, 'blunt');
  assert.ok(result.data.records.length);
  assert.ok(result.data.messages.some(m => m.role === 'event' && m.text.includes('阿直')));
  const isolated = await api('/state', { token: other.token });
  assert.equal(isolated.data.records.length, 0);
  assert.equal(isolated.data.messages.length, 0);
});
test('pending tasks cannot be completed; confirmed ones can', async () => {
  const result = await api('/records', { token: user.token, method: 'POST', body: { kind: 'task', payload: { title: '交材料', due: '2026-09-20T15:00:00+08:00' } } });
  const id = result.data.proposed.id;
  assert.equal((await api(`/records/${id}/complete`, { token: user.token, method: 'POST', body: { completed: true } })).status, 400);
  await api(`/records/${id}/confirm`, { token: user.token, method: 'POST', body: {} });
  const done = await api(`/records/${id}/complete`, { token: user.token, method: 'POST', body: { completed: true } });
  assert.equal(done.data.records.find(r => r.id === id).completed, 1);
});
test('billing stays disabled and missing AI is not replaced with fake replies', async () => {
  assert.equal((await api('/billing/checkout', { token: user.token, method: 'POST', body: {} })).status, 501);
  assert.equal((await api('/chat', { token: user.token, method: 'POST', body: { text: '你好' } })).status, 503);
  const state = await api('/state', { token: user.token });
  assert.equal(state.data.messages.filter(m => m.role === 'assistant').length, 0);
});
test('confirmed records can be corrected only by their owner', async () => {
  const state = await api('/state', { token: user.token });
  const expense = state.data.records.find(r => r.kind === 'expense');
  assert.equal((await api(`/records/${expense.id}`, { token: other.token, method: 'PATCH', body: { payload: { amount: 1 } } })).status, 404);
  const corrected = await api(`/records/${expense.id}`, { token: user.token, method: 'PATCH', body: { payload: { amount: 30, title: '午饭更正', category: '餐饮' } } });
  assert.equal(corrected.data.records.find(r => r.id === expense.id).payload.cents, 3000);
});
test('clearing history keeps tools usable and preserves confirmed records', async () => {
  const cleared = await api('/history', { token: user.token, method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.messages.length, 0);
  assert.equal(cleared.data.memories.length, 0);
  assert.ok(cleared.data.records.length > 0);
});

test('manual save is one explicit confirmation, idempotent and does not need AI', async () => {
  const body = { kind: 'expense', confirmed: true, requestId: randomUUID(), payload: { amount: '18.20', title: '快捷记账', date: '2026-09-16' } };
  const first = await api('/records', { token: user.token, method: 'POST', body });
  assert.equal(first.status, 201);
  assert.equal(first.data.proposed.status, 'confirmed');
  assert.equal(first.data.proposed.id, body.requestId);
  const repeat = await api('/records', { token: user.token, method: 'POST', body });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.records.filter(r => r.id === body.requestId).length, 1);
  assert.equal((await api('/records', { token: other.token, method: 'POST', body })).status, 409);
  assert.equal((await api('/records', { token: user.token, method: 'POST', body: { ...body, payload: { amount: 20 } } })).status, 409);
  assert.equal((await api('/records', { token: user.token, method: 'POST', body: { ...body, requestId: randomUUID(), payload: { amount: 1, direction: 'transfer' } } })).status, 400);
});

test('batch confirmations are atomic, editable, owner-scoped and retry-safe', async () => {
  const ids = [];
  for (const amount of [28, 6, 42]) {
    const result = await api('/records', { token: user.token, method: 'POST', body: { kind: 'expense', payload: { amount, title: '批量测试' } } });
    ids.push(result.data.proposed.id);
  }
  const items = ids.map(id => ({ id, revision: 0 }));
  const batch = body => api('/records/confirm-batch', { token: user.token, method: 'POST', body });
  assert.equal((await batch({ items: [items[0], { ...items[1], payload: { amount: -1 } }] })).status, 400);
  assert.equal((await api('/state', { token: user.token })).data.records.find(r => r.id === ids[0]).status, 'pending');
  assert.equal((await api('/records/confirm-batch', { token: other.token, method: 'POST', body: { items } })).status, 404);
  assert.equal((await batch({ items: [items[0], items[0]] })).status, 400);
  const body = { items: items.map((item, i) => ({ ...item, ...(i === 0 ? { payload: { amount: 18, title: '更正午饭' } } : {}) })) };
  const saved = await batch(body);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.records.find(r => r.id === ids[0]).payload.cents, 1800);
  for (const id of ids) assert.equal(saved.data.records.find(r => r.id === id).status, 'confirmed');
  assert.equal((await batch(body)).status, 200);
});

test('stale draft confirmation never overwrites a newer correction', async () => {
  const proposed = await api('/records', { token: user.token, method: 'POST', body: { kind: 'expense', payload: { amount: 80 } } });
  const id = proposed.data.proposed.id;
  const patched = await api(`/records/${id}`, { token: user.token, method: 'PATCH', body: { revision: 0, payload: { amount: 18 } } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.records.find(r => r.id === id).status, 'pending');
  assert.equal((await api(`/records/${id}/confirm`, { token: user.token, method: 'POST', body: { revision: 0, payload: { amount: 80 } } })).status, 409);
  assert.equal((await api('/records/confirm-batch', { token: user.token, method: 'POST', body: { items: [{ id, revision: 0 }] } })).status, 409);
  assert.equal((await api(`/records/${id}`, { token: user.token, method: 'PATCH', body: { revision: 0, payload: { amount: 80 } } })).status, 409);
  assert.equal((await api('/state', { token: user.token })).data.records.find(r => r.id === id).payload.cents, 1800);
});

test('trash and restore preserve records and account isolation; export only selected confirmed records', async () => {
  const result = await api('/records', { token: user.token, method: 'POST', body: { kind: 'expense', confirmed: true, payload: { amount: '0.10', date: '2026-07-01', title: '=SUM(1)', category: '导出测试' } } });
  const id = result.data.proposed.id;
  const removed = await api(`/records/${id}`, { token: user.token, method: 'DELETE' });
  assert.ok(!removed.data.records.some(r => r.id === id));
  assert.ok((await api('/records/trash', { token: user.token })).data.records.some(r => r.id === id));
  assert.equal((await api(`/records/${id}/restore`, { token: other.token, method: 'POST', body: {} })).status, 404);
  assert.equal((await api(`/records/${id}`, { token: user.token, method: 'PATCH', body: { payload: { amount: 1 } } })).status, 409);
  const restored = await api(`/records/${id}/restore`, { token: user.token, method: 'POST', body: {} });
  assert.equal(restored.data.records.find(r => r.id === id).payload.cents, 10);
  const path = `${base}/api/ledger/export?month=2026-07&category=${encodeURIComponent('导出测试')}`;
  assert.equal((await fetch(path)).status, 401);
  const exported = await fetch(path, { headers: { Authorization: `Bearer ${user.token}` } });
  assert.match(exported.headers.get('Content-Type'), /text\/csv/);
  const csv = await exported.text();
  assert.ok(csv.includes(`"'=SUM(1)"`));
  assert.ok(csv.includes('"0.10"'));
  assert.ok(csv.includes(id));
  assert.equal(csv.trim().split('\r\n').length, 2);
  const isolated = await fetch(path, { headers: { Authorization: `Bearer ${other.token}` } }).then(r => r.text());
  assert.ok(!isolated.includes(id));
  const differentDate = await fetch(`${path}&date=2026-07-31`, { headers: { Authorization: `Bearer ${user.token}` } }).then(r => r.text());
  assert.ok(!differentDate.includes(id));
});

test('snapshot and export do not truncate after 1000 records', async () => {
  const fixture = new DatabaseSync(join(data, 'app.sqlite'));
  const insert = fixture.prepare("INSERT INTO records (id,user_id,kind,payload,status,source,created) VALUES (?,?,'expense',?,'confirmed','manual',?)");
  fixture.exec('BEGIN');
  for (let i = 0; i < 1005; i++) insert.run(randomUUID(), other.user.id, JSON.stringify(validateRecord('expense', { amount: 1, date: '2026-06-01' })), '2026-06-01T00:00:00Z');
  fixture.exec('COMMIT'); fixture.close();
  assert.equal((await api('/state', { token: other.token })).data.records.length, 1005);
  const csv = await fetch(`${base}/api/ledger/export`, { headers: { Authorization: `Bearer ${other.token}` } }).then(r => r.text());
  assert.equal(csv.trim().split('\r\n').length, 1006);
});

test('personal debt APIs link repayment income, preserve due dates, enforce auth and protect linked records', async () => {
  assert.equal((await api('/debts')).status, 401);
  const before = (await api('/state', { token: user.token })).data.records.length;
  const body = { personName: '债务测试张三', direction: 'receivable', amount: '1000', date: '2026-01-01', dueDate: '2026-12-31', requestId: randomUUID() };
  const first = await api('/debts', { token: user.token, method: 'POST', body });
  assert.equal(first.status, 200);
  const id = first.data.billId;
  const second = await api('/debts', { token: user.token, method: 'POST', body: { ...body, amount: '500', requestId: randomUUID() } });
  assert.equal(second.data.people.length, 1);
  assert.equal(second.data.bills.length, 2);
  const payBody = { amount: '200', date: '2026-01-02', revision: 0, requestId: randomUUID() };
  const paid = await api(`/debts/${id}/payments`, { token: user.token, method: 'POST', body: payBody });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.bills.find(bill => bill.id === id).balanceCents, 80000);
  assert.equal((await api(`/debts/${id}/payments`, { token: other.token, method: 'POST', body: payBody })).status, 404);
  assert.equal((await api('/debts', { token: other.token })).data.bills.length, 0);
  assert.equal((await api('/state', { token: user.token })).data.records.length, before + 1);
  assert.equal(paid.data.bills.find(bill => bill.id === id).due_date, body.dueDate);
  assert.equal(paid.data.ledgerState.records.length, before + 1);
  const repayment = paid.data.payments[0];
  const incomeId = repayment.ledger_record_id;
  const income = paid.data.ledgerState.records.find(record => record.id === incomeId);
  assert.equal(income.payload.date, payBody.date);
  assert.equal(income.payload.cents, 20000);
  for (const [method, suffix, recordBody] of [
    ['PATCH', '', { payload: { ...income.payload, amount: 999 } }],
    ['DELETE', '', undefined], ['POST', '/reject', {}], ['POST', '/restore', {}],
  ]) {
    assert.equal((await api(`/records/${incomeId}${suffix}`, { token: user.token, method, body: recordBody })).status, 409);
  }
  assert.equal((await api(`/records/${incomeId}`, { token: other.token, method: 'DELETE' })).status, 404);
  await api(`/debts/${id}/payments`, { token: user.token, method: 'POST', body: payBody });
  assert.equal((await api('/state', { token: user.token })).data.records.length, before + 1);
  const undone = await api(`/debts/${id}/payments/${repayment.id}/void`, { token: user.token, method: 'POST', body: { revision: 1, reason: '测试撤销' } });
  assert.equal(undone.status, 200);
  assert.equal(undone.data.bills.find(bill => bill.id === id).balanceCents, 100000);
  assert.equal(undone.data.bills.find(bill => bill.id === id).due_date, body.dueDate);
  assert.equal(undone.data.ledgerState.records.length, before);
  assert.equal((await api(`/records/${incomeId}/restore`, { token: user.token, method: 'POST', body: {} })).status, 409);
  const fetched = await api('/debts', { token: user.token });
  assert.equal(fetched.data.payments[0].void_reason, '测试撤销');
});

test('repayment draft APIs reject missing bill, cross-account confirmation, stale drafts and generic save bypasses', async () => {
  const loan = await api('/debts', { token: user.token, method: 'POST', body: {
    personName: '助手测试', direction: 'receivable', amount: 1000, date: '2026-01-01', requestId: randomUUID(),
  } });
  const body = { kind: 'debt_repayment', payload: { personName: '助手测试', amount: 500, date: '2026-09-16' } };
  assert.equal((await api('/records', { token: user.token, method: 'POST', body: { ...body, confirmed: true } })).status, 409);
  const draft = await api('/records', { token: user.token, method: 'POST', body });
  assert.equal(draft.status, 201);
  const id = draft.data.proposed.id;
  const confirmation = { billId: loan.data.billId, billRevision: 0, revision: 0, amount: 500, date: '2026-09-16' };
  assert.equal((await api(`/records/${id}/confirm`, { token: user.token, method: 'POST', body: {} })).status, 409);
  assert.equal((await api('/records/confirm-batch', { token: user.token, method: 'POST', body: { items: [{ id, revision: 0 }] } })).status, 409);
  assert.equal((await api(`/records/${id}/confirm-debt`, { token: user.token, method: 'POST', body: { ...confirmation, billId: null } })).status, 400);
  assert.equal((await api(`/records/${id}/confirm-debt`, { token: other.token, method: 'POST', body: confirmation })).status, 404);
  assert.equal((await api(`/records/${id}/confirm-debt`, { token: user.token, method: 'POST', body: { ...confirmation, revision: 2 } })).status, 409);
  const accepted = await api(`/records/${id}/confirm-debt`, { token: user.token, method: 'POST', body: confirmation });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.debtState.bills.find(bill => bill.id === loan.data.billId).balanceCents, 50000);
  assert.equal((await api(`/records/${id}/reject`, { token: user.token, method: 'POST', body: {} })).status, 409);
});
