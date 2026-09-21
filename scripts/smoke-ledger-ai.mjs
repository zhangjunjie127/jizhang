import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
let token;
async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
token = (await api('/register', { username: `ledger-ai-${Date.now()}`, password: 'LedgerAiTest916!', name: '记账测试', birthday: '2000-01-01', invite: process.env.INVITE_CODE })).token;
await api('/profile', { proactive: false }, 'PATCH');
const proposed = await api('/chat', { text: '请记账：2026年9月16日午饭28元、地铁6元，9月15日买菜42元，都是支出。先出草稿等我核对。' });
assert.equal(proposed.records.length, 3);
assert.ok(proposed.records.every(r => r.status === 'pending'));
assert.deepEqual(proposed.records.map(r => r.payload.cents).sort((a, b) => a - b), [600, 2800, 4200]);
assert.equal(proposed.records.find(r => r.payload.cents === 600).payload.category, '交通');
assert.equal(proposed.records.find(r => r.payload.cents === 2800).payload.category, '餐饮');
const target = proposed.records.find(r => r.payload.cents === 2800);
const corrected = await api('/chat', { text: '刚才午饭说错了，是18元，不是28元，只改午饭那条草稿，其他两笔不变。' });
assert.equal(corrected.records.length, 3);
assert.equal(corrected.records.find(r => r.id === target.id).payload.cents, 1800);
assert.ok(corrected.records.every(r => r.status === 'pending'));
const saved = await api('/records/confirm-batch', { items: corrected.records.map(({ id, revision }) => ({ id, revision })) });
assert.ok(saved.records.every(r => r.status === 'confirmed'));
const report = { passed: true, actualModelCalls: 2, multiRecordDrafts: true, correctedOriginalDraft: true, userConfirmationRequired: true,
  replies: corrected.messages.filter(m => m.role === 'assistant').map(m => m.text), records: saved.records.map(({ status, payload }) => ({ status, payload })) };
writeFileSync('artifacts/ledger-ai-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
