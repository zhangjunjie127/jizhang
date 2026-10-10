import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEDGER_CENTS, exactMoney, moneyLabels } from '../shared/money.mjs';
import { validateRecord } from '../server/domain.mjs';
import { receiptCents } from '../shared/receipt.mjs';

test('ledger and receipt amounts accept the cent-exact eight-digit limit', () => {
  for (const amount of ['1000000.01', '10000000.00', '99999999.99']) {
    assert.equal(validateRecord('expense', { amount }).cents, Math.round(Number(amount) * 100));
    assert.equal(receiptCents(amount), Math.round(Number(amount) * 100));
  }
  assert.equal(receiptCents('99999999.99'), MAX_LEDGER_CENTS);
  for (const amount of ['100000000', '99999999.999', '1e8', 'Infinity']) {
    assert.throws(() => validateRecord('expense', { amount }));
    assert.throws(() => receiptCents(amount));
  }
});

test('display labels keep exact amounts available before compact alternatives', () => {
  assert.equal(exactMoney(MAX_LEDGER_CENTS), '99,999,999.99');
  assert.deepEqual(moneyLabels(123456789), ['1,234,567.89', '1.23百万']);
  assert.deepEqual(moneyLabels(1234567890), ['12,345,678.90', '1.23千万']);
  assert.deepEqual(moneyLabels(-1234567890), ['-12,345,678.90', '-1.23千万']);
  assert.deepEqual(moneyLabels(100, '+'), ['+1.00']);
});
