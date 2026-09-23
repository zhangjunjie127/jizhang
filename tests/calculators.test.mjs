import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTool } from '../shared/calculators.mjs';

test('salary estimates annual-average net income without subtracting tax-only allowances', () => {
  assert.equal(calculateTool('salary', { salary: 5000 }).value, 5000);
  assert.equal(calculateTool('salary', { salary: 10000 }).value, 9710);
  const result = calculateTool('salary', { salary: 10000, social: 1000, fund: 1000, special: 1000 });
  assert.equal(result.value, 7940);
  assert.match(result.detail, /全年个税 720.00/);
  assert.equal(calculateTool('salary', { salary: 10000, social: 1000, fund: 1000, special: 10000 }).value, 8000);
  assert.equal(calculateTool('salary', { salary: 0 }).value, 0);
  assert.throws(() => calculateTool('salary', { salary: '' }));
  assert.throws(() => calculateTool('salary', { salary: 1000, social: 1001 }));
  assert.throws(() => calculateTool('salary', { salary: 1000, fund: -1 }));
});
test('salary annual tax bracket boundaries and upper bracket', () => {
  for (const [taxable, tax] of [[36000, 1080], [144000, 11880], [300000, 43080], [420000, 73080], [660000, 145080], [960000, 250080], [1200000, 358080]]) {
    const salary = taxable / 12 + 5000;
    assert.match(calculateTool('salary', { salary }).detail, new RegExp(`全年个税 ${tax.toFixed(2)}`));
  }
});

test('input validation and no built-in basic calculator fallback', () => {
  assert.throws(() => calculateTool('basic', {}), /未知计算工具/);
  assert.throws(() => calculateTool('lesson', { count: '', price: 2 }), /请填写/);
  assert.throws(() => calculateTool('lesson', { count: 'Infinity', price: 2 }));
});
test('discount, exact-cent split, lesson fees', () => {
  assert.equal(calculateTool('discount', { price: 100, discount: 8.5, reduction: 10 }).value, 75);
  assert.equal(calculateTool('discount', { price: 10, discount: 8, reduction: 20 }).value, 0);
  assert.equal(calculateTool('split', { total: 100, people: 3 }).value, 33.33);
  assert.match(calculateTool('split', { total: 100, people: 3 }).detail, /1 人各付 33.34/);
  assert.throws(() => calculateTool('split', { total: 100, people: 0 }));
  assert.throws(() => calculateTool('split', { total: 100, people: 1.5 }));
  assert.equal(calculateTool('lesson', { count: 2.5, price: 100 }).value, 250);
});
test('normalized unit comparison and removed purchase tool', () => {
  const rows = [{ name: 'A', price: '10', quantity: '2' }, { name: 'B', price: '12', quantity: '3' }];
  assert.throws(() => calculateTool('purchase', {}, rows), /未知计算工具/);
  assert.equal(calculateTool('compare', {}, rows).value, 4);
  assert.match(calculateTool('compare', {}, rows).detail, /B.*最低/);
  assert.throws(() => calculateTool('compare', {}, [{ name: '', price: '1', quantity: '0' }]));
  assert.throws(() => calculateTool('compare', {}, rows.slice(0, 1)));
});
test('simple interest and both loan methods including zero and tiny rates', () => {
  assert.equal(calculateTool('interest', { principal: 10000, rate: 3.65, days: 100, basis: 365 }).value, 100);
  assert.equal(calculateTool('interest', { principal: 10000, rate: 3.6, days: 100, basis: 360 }).value, 100);
  const loan = { principal: 120000, rate: 6, months: 12 };
  assert.equal(calculateTool('mortgage', loan).value, 10327.97);
  assert.equal(calculateTool('mortgage', { ...loan, method: 'equalPrincipal' }).value, 10600);
  assert.equal(calculateTool('mortgage', { ...loan, rate: 0 }).value, 10000);
  assert.equal(calculateTool('mortgage', { ...loan, rate: 0.000000001 }).value, 10000);
  assert.throws(() => calculateTool('mortgage', { ...loan, months: 0 }));
});

test('currency rounding preserves half-cent values and split totals', () => {
  assert.equal(calculateTool('lesson', { count: '1', price: '10.075' }).value, 10.08);
  assert.equal(calculateTool('split', { total: '1.005', people: '1' }).value, 1.01);
});

test('only decimal inputs and supported operations are accepted', () => {
  for (const a of ['0x10', '0b10', 'NaN', 'Infinity', 'abc']) {
    assert.throws(() => calculateTool('lesson', { count: a, price: 1 }));
  }
});

test('zero values, ties and boundary values stay consistent', () => {
  assert.equal(calculateTool('discount', { price: 100, discount: 0 }).value, 0);
  assert.equal(calculateTool('discount', { price: 100, discount: 10 }).value, 100);
  assert.equal(calculateTool('split', { total: 0, people: 5 }).value, 0);
  assert.match(calculateTool('split', { total: 0.01, people: 3 }).detail, /1 人各付 0.01 元/);
  assert.equal(calculateTool('interest', { principal: 100, rate: 0, days: 0, basis: 365 }).value, 0);
  assert.equal(calculateTool('mortgage', { principal: 0, rate: 5, months: 360 }).value, 0);
  assert.equal(calculateTool('mortgage', { principal: 120, rate: 12, months: 1 }).value, 121.2);
  const rows = [{ name: 'A', price: 10, quantity: 2 }, { name: 'B', price: 15, quantity: 3 }];
  assert.equal(calculateTool('compare', {}, rows).detail.match(/最低/g).length, 2);
});

test('bullet loans use monthly simple interest and clamp maturity to month end', () => {
  const fields = { loanType: 'bullet', principal: 120000, rate: 6, months: 12, loanDate: '2024-02-29' };
  const monthly = calculateTool('mortgage', fields);
  assert.equal(monthly.value, 600);
  assert.match(monthly.detail, /到期日期 2025-02-28/);
  assert.match(monthly.detail, /到期应付 120600.00/);
  assert.match(monthly.detail, /总利息 7200.00/);
  assert.equal(calculateTool('mortgage', { ...fields, interestMethod: 'maturity' }).value, 127200);
  assert.match(calculateTool('mortgage', { ...fields, months: 1, loanDate: '2026-01-31' }).detail, /2026-02-28/);
  for (const loanDate of ['', '2026-02-30', 'bad']) assert.throws(() => calculateTool('mortgage', { ...fields, loanDate }));
  assert.equal(calculateTool('mortgage', { ...fields, rate: 0 }).value, 0);
});

test('introductory discount restores base rate and recalculates remaining payments', () => {
  const fields = { loanType: 'fixed', principal: 1200, rate: 12, months: 2, discountMonths: 1, rateDiscount: 0 };
  const result = calculateTool('mortgage', fields);
  assert.equal(result.value, 600);
  assert.match(result.detail, /月供 606.00/);
  assert.match(result.detail, /总利息 6.00/);
  const constant = { ...fields, principal: 120000, rate: 6, months: 12, rateDiscount: 100 };
  assert.equal(calculateTool('mortgage', constant).value, calculateTool('mortgage', { ...constant, loanType: 'standard' }).value);
  assert.equal(calculateTool('mortgage', { ...constant, discountMonths: 12, rateDiscount: 50 }).value,
    calculateTool('mortgage', { ...constant, loanType: 'standard', rate: 3 }).value);
  const principal = calculateTool('mortgage', { ...fields, rateDiscount: 50, method: 'equalPrincipal' });
  assert.equal(principal.value, 606);
  assert.match(principal.detail, /总利息 12.00/);
  for (const patch of [{ discountMonths: 3 }, { discountMonths: 0 }, { rateDiscount: 101 }, { rateDiscount: '' }, { months: 361 }]) {
    assert.throws(() => calculateTool('mortgage', { ...fields, ...patch }));
  }
  assert.equal(calculateTool('mortgage', { ...fields, rate: 0 }).value, 600);
});
