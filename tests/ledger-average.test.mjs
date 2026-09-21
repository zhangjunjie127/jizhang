import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPeriodDays } from '../shared/ledger.mjs';

test('daily average uses calendar days, including zero-spend days and leap years', () => {
  assert.equal(ledgerPeriodDays([], '2026-09', '2026-09-17'), 17);
  assert.equal(ledgerPeriodDays([], '2026', '2026-09-17'), 260);
  assert.equal(ledgerPeriodDays([], '2024', '2026-09-17'), 366);
  assert.equal(ledgerPeriodDays([], '2026', '2026-01-01'), 1);
  assert.equal(ledgerPeriodDays([], '2026-08', '2026-09-17'), 31);
  assert.equal(ledgerPeriodDays([], '2024-02', '2026-09-17'), 29);
  assert.equal(ledgerPeriodDays([], '2026-09', '2026-09-01'), 1);
  assert.equal(ledgerPeriodDays([], '2026-10', '2026-09-17'), 31);
  assert.equal(ledgerPeriodDays([], '', '2026-09-17'), 1);
  const record = (date, status = 'confirmed') => ({ kind: 'expense', status, payload: { date } });
  assert.equal(ledgerPeriodDays([record('2026-09-14'), record('2026-08-01', 'pending')], '', '2026-09-17'), 4);
});
