import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord } from '../server/domain.mjs';
import { validateReceipt } from '../shared/receipt.mjs';
import { receiptImage, receiptDraft } from '../server/receipt.mjs';
import { summarizeLedger } from '../shared/ledger.mjs';

export const sampleReceipt = () => ({
  title: '测试超市', date: '2026-09-17', amount: 21.5, category: '购物', direction: 'expense',
  receipt: {
    currency: 'CNY', merchant: '测试超市', adjustmentAmount: -2, adjustmentLabel: '整单优惠',
    imageHash: 'a'.repeat(64),
    items: [
      { name: '牛奶', quantity: 2, unit: '盒', amount: 10, category: '餐饮' },
      { name: '纸巾', quantity: 1, unit: '包', amount: 13.5, category: '购物' },
    ],
  },
});
test('receipt is one ledger expense with persisted line items and exact discount math', () => {
  const payload = validateRecord('expense', sampleReceipt());
  assert.equal(payload.cents, 2150);
  assert.equal(payload.receipt.items[0].cents, 1000, 'Row subtotal must not be multiplied by quantity');
  assert.equal(payload.receipt.adjustmentCents, -200);
  assert.equal(summarizeLedger([{ id: '1', kind: 'expense', status: 'confirmed', created: '', payload }]).expense, 2150);
});
test('receipt rejects mismatches, unknown amounts, quantity, foreign currency and absent date', () => {
  const p = sampleReceipt();
  assert.throws(() => validateReceipt(p.receipt, 2000), /不一致/);
  for (const changes of [{ amount: '' }, { quantity: 0 }, { quantity: '' }, { amount: '1.001' }]) {
    assert.throws(() => validateReceipt({ ...p.receipt, items: [{ ...p.receipt.items[0], ...changes }] }, 1000));
  }
  assert.throws(() => validateReceipt({ ...p.receipt, currency: 'USD' }, 2150));
  assert.throws(() => validateRecord('expense', { ...p, date: '' }));
  assert.throws(() => validateRecord('expense', { ...p, direction: 'income' }));
  assert.throws(() => validateReceipt({ ...p.receipt, adjustmentLabel: '' }, 2150));
});
test('image input is bounded data-only and OCR unknown values stay unknown', () => {
  assert.throws(() => receiptImage('https://example.com/private'));
  assert.throws(() => receiptImage('data:image/jpeg;base64,aGVsbG8='));
  assert.throws(() => receiptImage('data:image/svg+xml;base64,aGVsbG8='));
  const result = receiptDraft(JSON.stringify({
    isReceipt: true, currency: 'CNY', date: null, total: null, adjustmentAmount: null,
    items: [{ name: '商品', quantity: null, amount: null, category: '购物' }],
  }), 'b'.repeat(64));
  assert.equal(result.payload.date, '');
  assert.equal(result.payload.amount, '');
  assert.equal(result.payload.receipt.items[0].quantity, '');
  assert.ok(result.warnings.length);
  assert.throws(() => receiptDraft('not json', ''), /格式异常/);
  assert.throws(() => receiptDraft('{"isReceipt":false}', ''), /没有识别/);
});
