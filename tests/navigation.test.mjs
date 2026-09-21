import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_LABELS, initialPage, pendingForPage, requestId } from '../src/navigation.js';

test('four modules and profile have direct routes and old combined pages fall back safely', () => {
  assert.deepEqual(Object.values(PAGE_LABELS), ['助手', '待办', '记账', '健康', '我的']);
  assert.equal(initialPage('mine'), 'mine');
  assert.equal(initialPage('records'), 'ledger');
  assert.equal(initialPage('today'), 'ledger');
  assert.equal(initialPage('health'), 'health');
  assert.equal(initialPage('toString'), 'ledger');
});
test('each tool page shows only its own drafts; chat retains the shared queue', () => {
  const records = ['task', 'expense', 'weight', 'debt_repayment'].map(kind => ({ kind, status: 'pending' }));
  records.push({ kind: 'task', status: 'confirmed' });
  assert.deepEqual(pendingForPage(records, 'ledger').map(r => r.kind), ['expense', 'debt_repayment']);
  assert.deepEqual(pendingForPage(records, 'tasks').map(r => r.kind), ['task']);
  assert.deepEqual(pendingForPage(records, 'health').map(r => r.kind), ['weight']);
  assert.equal(pendingForPage(records, 'chat').length, 4);
});
test('request IDs are UUID v4 values without depending on secure-context randomUUID', () => {
  assert.match(requestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(requestId(), requestId());
});
